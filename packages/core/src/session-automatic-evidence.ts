import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base, snapshot, type Device } from "./device.js";
import { now } from "./events.js";
import { inferIosSnapshotGeometry, normalizeScreenshotToBounds } from "./ios-geometry.js";
import { unknownErrorMessage } from "./ios-runner-listener-command.js";
import { captureIosPngViaGoIos, pixelEvidenceFingerprint } from "./ios-app-launch.js";
import { readIosDisplayOrientation } from "./ios-device-adapter.js";
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
  let snapshotNodes = observation?.nodes;
  let observedAt = observation?.observedAt ?? now();
  try {
    if (!snapshotNodes) {
      if (phase === "after" && job.platform === "ios") {
        // Catalog snapshot after a Grok library open queries absent home ids
        // and XCTest walks the conversation list until the runner dies.
        snapshotNodes = [];
      } else {
        snapshotNodes = await snapshot(device);
        observedAt = now();
      }
    }
    job.artifacts.push({
      kind: "ui-tree",
      capturedAt: observedAt,
      data: { stepId: step.id, phase, nodes: snapshotNodes },
    });
  } catch (error) {
    const message = unknownErrorMessage(error);
    if (job.platform === "ios" && /session|open first/i.test(message)) {
      if (!job.logs.some((line) => line.includes("accessibility tree unavailable"))) {
        log("warn: iOS accessibility tree unavailable — collecting screenshots from pixels");
      }
    } else {
      log(`warn: ${phase} UI-tree capture failed: ${message}`);
    }
  }
  if (runtime && !observation) {
    runtime.observation = { observedAt, ...(snapshotNodes ? { nodes: snapshotNodes } : {}) };
  }

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
      return;
    }
    const captureRaster = async () => {
      let bytes: Buffer;
      if (job.platform === "ios" && job.serial) {
        try {
          await captureIosPngViaGoIos(job.serial, temporary);
          bytes = await readFile(temporary);
        } catch {
          const result = await device.capture.screenshot({ ...base(), path: temporary });
          bytes = result.base64 ? Buffer.from(result.base64, "base64") : await readFile(temporary);
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
    if (phase === "after") {
      job.artifacts.push({
        kind: "visual-settling",
        capturedAt: now(),
        data: {
          stepId: step.id,
          phase,
          settled: captured.settled,
          samples: captured.samples,
          stabilityMeasured: false,
        },
      });
    }
    if (job.platform === "ios") {
      const geometry = snapshotNodes ? inferIosSnapshotGeometry(snapshotNodes) : undefined;
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
  } catch (error) {
    log(
      `warn: ${phase} screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
