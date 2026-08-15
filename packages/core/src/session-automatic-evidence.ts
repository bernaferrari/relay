import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { base, snapshot, type Device } from "./device.js";
import { now } from "./events.js";
import { inferIosSnapshotGeometry, normalizeScreenshotToBounds } from "./ios-geometry.js";
import { captureIosPngViaGoIos } from "./ios-app-launch.js";
import { visualEvidenceAllowed } from "./redaction.js";
import type { RecipeRuntimeState } from "./recipe-runner-context.js";
import { ensureRunDir, writeFramePng } from "./runs.js";
import type { TestJob } from "./session-contract.js";
import type { TraceStep } from "./trace.js";

export async function captureAutomaticState(
  job: TestJob,
  device: Device,
  step: TraceStep,
  phase: "before" | "after",
  log: (line: string) => void,
  runtime?: RecipeRuntimeState,
): Promise<void> {
  if (process.env.RELAY_AUTO_VISUAL_EVIDENCE === "0" || !visualEvidenceAllowed()) return;
  const observation = runtime?.observation ?? runtime?.verifiedScreen;
  let snapshotNodes = observation?.nodes;
  let observedAt = observation?.observedAt ?? now();
  try {
    if (!snapshotNodes) {
      snapshotNodes = await snapshot(device);
      observedAt = now();
    }
    job.artifacts.push({
      kind: "ui-tree",
      capturedAt: observedAt,
      data: { stepId: step.id, phase, nodes: snapshotNodes },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    if (cachedScreenshot) {
      const existing = cachedScreenshot.framePath
        ? job.frames.find((frame) => frame.path === cachedScreenshot.framePath)
        : undefined;
      if (existing) {
        if (!step.frames.some((frame) => frame.path === existing.path)) {
          step.frames.push({ ...existing });
        }
      } else {
        const frame = await writeFramePng(job, cachedScreenshot.base64, `${phase} · ${step.title}`);
        step.frames.push({ ...frame, base64: undefined });
        cachedScreenshot.framePath = frame.path;
      }
      return;
    }
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
    if (job.platform === "ios") {
      const geometry = snapshotNodes ? inferIosSnapshotGeometry(snapshotNodes) : undefined;
      const bounds = geometry
        ? { width: geometry.logicalWidth, height: geometry.logicalHeight }
        : undefined;
      const orientation =
        bounds && bounds.width > bounds.height
          ? "landscape-right"
          : bounds && bounds.height > bounds.width
            ? "portrait"
            : bytes.length > 24 && bytes.readUInt32BE(16) > bytes.readUInt32BE(20)
              ? "landscape-right"
              : "portrait";
      bytes = normalizeScreenshotToBounds(bytes, bounds, orientation);
    }
    const encoded = bytes.toString("base64");
    const frame = await writeFramePng(job, encoded, `${phase} · ${step.title}`);
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
      if (runtime.verifiedScreen) runtime.verifiedScreen.screenshot = screenshot;
    }
  } catch (error) {
    log(
      `warn: ${phase} screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
