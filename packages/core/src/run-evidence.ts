import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { base, type Device } from "./device.js";
import { now } from "./events.js";
import { ensureRunDir, type RunArtifact } from "./runs.js";
import type { TestJob } from "./session.js";

export type RunEvidenceHandle = {
  startedAt: number;
  recordingStarted: boolean;
  stopped: boolean;
};

function addArtifact(job: TestJob, artifact: RunArtifact): void {
  job.artifacts.push(artifact);
}

/**
 * Evidence collection is deliberately best-effort. A recorder or telemetry
 * failure must never turn a valid product run into a harness failure.
 */
export async function startRunEvidence(
  job: TestJob,
  device: Device,
  log: (line: string) => void,
): Promise<RunEvidenceHandle> {
  const startedAt = now();
  const handle: RunEvidenceHandle = { startedAt, recordingStarted: false, stopped: false };

  try {
    const performance = await withTimeout(
      device.observability.perf({ ...base() }),
      5_000,
      "performance capture",
    );
    addArtifact(job, { kind: "performance-start", capturedAt: now(), data: performance });
  } catch (error) {
    log(`warn: starting performance capture failed: ${messageOf(error)}`);
  }

  try {
    const runDir = await ensureRunDir(job);
    const path = join(runDir, "video", "run.mp4");
    const result = await withTimeout(
      device.recording.record({
        ...base(),
        action: "start",
        path,
        fps: 30,
        quality: "high",
        hideTouches: true,
      }),
      10_000,
      "video recorder start",
    );
    if (result && typeof result === "object" && "started" in result && result.started === false) {
      const warning =
        "warning" in result && typeof result.warning === "string"
          ? result.warning
          : "Video recording is unavailable";
      log(`warn: ${warning}`);
      return handle;
    }
    handle.recordingStarted = true;
    addArtifact(job, {
      kind: "video-start",
      capturedAt: startedAt,
      data: { path: "video/run.mp4", result },
    });
    log("evidence: video recording started");
  } catch (error) {
    log(`warn: video recording unavailable: ${messageOf(error)}`);
  }

  return handle;
}

export async function stopRunEvidence(
  handle: RunEvidenceHandle | undefined,
  job: TestJob,
  device: Device | undefined,
  log: (line: string) => void,
): Promise<void> {
  if (!handle || handle.stopped || !device) return;
  handle.stopped = true;

  try {
    const performance = await withTimeout(
      device.observability.perf({ ...base() }),
      5_000,
      "performance capture",
    );
    addArtifact(job, { kind: "performance-end", capturedAt: now(), data: performance });
  } catch (error) {
    log(`warn: finishing performance capture failed: ${messageOf(error)}`);
  }

  if (handle.recordingStarted) {
    try {
      const result = await withTimeout(
        device.recording.record({ ...base(), action: "stop" }),
        10_000,
        "video recorder stop",
      );
      const files = await videoFiles(job);
      addArtifact(job, {
        kind: "video",
        capturedAt: now(),
        data: {
          startedAt: handle.startedAt,
          stoppedAt: now(),
          durationMs: Math.max(0, now() - handle.startedAt),
          files,
          result,
        },
      });
      log(
        files.length > 0 ? "evidence: video saved" : "warn: recorder stopped without a video file",
      );
    } catch (error) {
      log(`warn: stopping video recording failed: ${messageOf(error)}`);
    }
  }
}

async function videoFiles(job: TestJob): Promise<Array<{ path: string; bytes: number }>> {
  if (!job.runDir) return [];
  const dir = join(job.runDir, "video");
  try {
    const entries = await readdir(dir);
    const files = await Promise.all(
      entries
        .filter((file) => /\.(mp4|webm)$/i.test(file))
        .sort()
        .map(async (file) => {
          const info = await stat(join(dir, file));
          return { path: `video/${file}`, bytes: info.size };
        }),
    );
    return files.filter((file) => file.bytes > 0);
  } catch {
    return [];
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
