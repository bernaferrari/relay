import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base, snapshot, type Device, type SnapshotNode } from "./device.js";
import { now } from "./events.js";
import { inferIosSnapshotGeometry, normalizeScreenshotToBounds } from "./ios-geometry.js";
import { unknownErrorMessage } from "./ios-runner-listener-command.js";
import { captureIosPngViaGoIos, pixelEvidenceFingerprint } from "./ios-app-launch.js";
import { readIosDisplayOrientation } from "./ios-device-adapter.js";
import { OPTIONAL_TREE_BUDGET_MS, withOptionalTreeBudget } from "./optional-tree-budget.js";
import { visualEvidenceAllowed } from "./redaction.js";
import type { RecipeRuntimeState } from "./recipe-runner-context.js";
import { currentVerifiedScreen } from "./recipe-runner-context.js";
import { ensureRunDir, writeFramePng } from "./runs.js";
import { targetRuntimeReadiness } from "./target-runtime-readiness.js";
import type { TestJob } from "./session-contract.js";
import type { TraceStep } from "./trace.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

/** Cached rasters stay reusable only while the device pixels are the same
 * ones this cache captured. A newer observation epoch (any capture that began
 * after this screenshot's own epoch) or a changed sampled-pixel fingerprint
 * means the screen may have moved and the raster must be recaptured. */
async function cachedScreenshotIsFresh(job: TestJob, cached: ScreenshotPayload): Promise<boolean> {
  if (!job.serial || job.platform !== "ios") return true;
  // Epoch fence: any pixel capture that began after this cached raster was
  // taken advanced the target's observation epoch, so the cache is stale by
  // order alone — no need to sample pixels.
  const proofAt = targetRuntimeReadiness({ serial: job.serial, platform: "ios" }, Date.now())
    .previewPixels.proof?.at;
  if (proofAt !== undefined && proofAt > cached.capturedAt) return false;
  try {
    const sampleDir = await mkdtemp(join(tmpdir(), "relay-evidence-fence-"));
    try {
      const samplePath = join(sampleDir, "sample.png");
      await captureIosPngViaGoIos(job.serial, samplePath);
      const sample = await readFile(samplePath);
      return (
        pixelEvidenceFingerprint(sample) ===
        pixelEvidenceFingerprint(Buffer.from(cached.base64, "base64"))
      );
    } finally {
      await rm(sampleDir, { recursive: true, force: true });
    }
  } catch {
    // A failed probe is not evidence of freshness. Recapture for a current frame.
    return false;
  }
}

function recordAutomaticTreeFailure(
  job: TestJob,
  step: TraceStep,
  phase: "before" | "after",
  log: (line: string) => void,
  error: unknown,
  framePath?: string,
): void {
  const message = unknownErrorMessage(error);
  if (job.platform === "ios" && /session|open first/i.test(message)) {
    if (!job.logs.some((line) => line.includes("accessibility tree unavailable"))) {
      log("warn: iOS accessibility tree unavailable — collecting screenshots from pixels");
    }
  } else {
    log(`warn: ${phase} UI-tree capture failed: ${message}`);
  }
  job.artifacts.push({
    kind: "ui-tree",
    capturedAt: now(),
    data: {
      stepId: step.id,
      phase,
      status: "failed",
      error: message,
      nodes: [],
      ...(framePath ? { framePath } : {}),
    },
  });
}

async function collectAutomaticEvidenceTree(input: {
  job: TestJob;
  device: Device;
  step: TraceStep;
  phase: "before" | "after";
  log: (line: string) => void;
  runtime?: RecipeRuntimeState;
  observation?: { observedAt: number; nodes?: readonly SnapshotNode[] };
  framePath?: string;
}): Promise<void> {
  const { job, device, step, phase, log, runtime, observation, framePath } = input;
  let snapshotNodes = observation?.nodes ? [...observation.nodes] : undefined;
  let observedAt = observation?.observedAt ?? now();
  try {
    if (!snapshotNodes) {
      if (phase === "after" && job.platform === "ios") {
        // Catalog snapshot after a Grok library open queries absent home ids
        // and XCTest walks the conversation list until the runner dies. This
        // omitted read must stay absent from the runtime cache so destination
        // verification acquires current AX instead of reusing a synthetic [].
        job.artifacts.push({
          kind: "ui-tree",
          capturedAt: now(),
          data: {
            stepId: step.id,
            phase,
            status: "skipped",
            nodes: [],
            ...(framePath ? { framePath } : {}),
          },
        });
        return;
      } else {
        snapshotNodes = await withOptionalTreeBudget(OPTIONAL_TREE_BUDGET_MS, () =>
          snapshot(device, {
            retryAttempts: 1,
            timeoutMs: OPTIONAL_TREE_BUDGET_MS,
          }),
        );
        observedAt = now();
      }
    }
    job.artifacts.push({
      kind: "ui-tree",
      capturedAt: observedAt,
      data: { stepId: step.id, phase, nodes: snapshotNodes },
    });
  } catch (error) {
    recordAutomaticTreeFailure(job, step, phase, log, error, framePath);
  }
  if (runtime && !observation) {
    const current = runtime.observation ?? { observedAt };
    if (snapshotNodes) {
      current.nodes = snapshotNodes;
      current.observedAt = observedAt;
    }
    runtime.observation = current;
  }
}

export async function captureAutomaticState(
  job: TestJob,
  device: Device,
  step: TraceStep,
  phase: "before" | "after",
  log: (line: string) => void,
  runtime?: RecipeRuntimeState,
): Promise<void> {
  if (process.env.RELAY_AUTO_VISUAL_EVIDENCE === "0" || !visualEvidenceAllowed()) return;
  const observation = runtime?.observation ?? currentVerifiedScreen(runtime);
  const cachedNodes = observation?.nodes;
  const observedAt = observation?.observedAt ?? now();

  const runDir = await ensureRunDir(job);
  await mkdir(join(runDir, "frames"), { recursive: true });
  const temporary = join(runDir, "frames", `.capture-${randomUUID()}.png`);
  try {
    const cachedScreenshot = observation?.screenshot;
    if (
      phase === "before" &&
      cachedScreenshot &&
      (await cachedScreenshotIsFresh(job, cachedScreenshot))
    ) {
      const existing = cachedScreenshot.framePath
        ? job.frames.find((frame) => frame.path === cachedScreenshot.framePath)
        : undefined;
      if (existing) {
        if (!step.frames.some((frame) => frame.path === existing.path)) {
          step.frames.push({ ...existing });
        }
      } else {
        const frame = await writeFramePng(
          job,
          cachedScreenshot.base64,
          `${phase} · ${step.title}`,
          { stepId: step.id, capturedAt: cachedScreenshot.capturedAt },
        );
        step.frames.push({ ...frame, base64: undefined });
        cachedScreenshot.framePath = frame.path;
      }
    } else {
      const captureRaster = async () => {
        let bytes: Buffer;
        if (job.platform === "ios" && job.serial) {
          try {
            await captureIosPngViaGoIos(job.serial, temporary);
            bytes = await readFile(temporary);
          } catch {
            const result = await device.capture.screenshot({ ...base(), path: temporary });
            bytes = result.base64
              ? Buffer.from(result.base64, "base64")
              : await readFile(temporary);
          }
        } else {
          const result = await device.capture.screenshot({ ...base(), path: temporary });
          bytes = result.base64 ? Buffer.from(result.base64, "base64") : await readFile(temporary);
        }
        return bytes;
      };
      // One PNG. Dest-end chrome that already matched must not enter the
      // 4-sample / 500ms still loop (`captureSettledRaster`) — that is an
      // 8–16s tax per assertion on Android. Failures still get this frame.
      const captured = { value: await captureRaster(), settled: false, samples: 1 };
      let bytes = captured.value;
      if (job.platform === "ios") {
        const geometry = cachedNodes ? inferIosSnapshotGeometry([...cachedNodes]) : undefined;
        const bounds = geometry
          ? { width: geometry.logicalWidth, height: geometry.logicalHeight }
          : undefined;
        // Orientation comes from real evidence only, matching workspace-capture:
        // CoreDevice display orientation when bounds exist, else the logical AX
        // viewport aspect. Guessing every wide PNG into landscape-left turned
        // correct portrait frames sideways.
        const orientation = bounds
          ? job.serial
            ? await readIosDisplayOrientation(job.serial).catch(() => undefined)
            : undefined
          : undefined;
        bytes = normalizeScreenshotToBounds(bytes, bounds, orientation);
      }
      const encoded = bytes.toString("base64");
      const frame = await writeFramePng(job, encoded, `${phase} · ${step.title}`, {
        stepId: step.id,
      });
      step.frames.push({ ...frame, base64: undefined });
      if (phase === "after") {
        job.artifacts.push({
          kind: "visual-settling",
          capturedAt: frame.capturedAt,
          data: {
            stepId: step.id,
            phase,
            settled: captured.settled,
            samples: captured.samples,
            stabilityMeasured: false,
          },
        });
      }
      if (runtime) {
        const screenshot = {
          capturedAt: frame.capturedAt,
          mime: "image/png" as const,
          base64: encoded,
          path: temporary,
          bytes: bytes.byteLength,
          ...(bytes.length > 24
            ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
            : {}),
          jobId: job.id,
          framePath: frame.path,
        };
        const current = runtime.observation ?? { observedAt };
        current.screenshot = screenshot;
        runtime.observation = current;
        const verified = currentVerifiedScreen(runtime);
        if (verified) verified.screenshot = screenshot;
      }
    }
  } catch (error) {
    log(
      `warn: ${phase} screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await unlink(temporary).catch(() => undefined);
  }

  await collectAutomaticEvidenceTree({
    job,
    device,
    step,
    phase,
    log,
    runtime,
    observation,
    framePath: step.frames.at(-1)?.path,
  });
}
