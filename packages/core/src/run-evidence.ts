import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceChannel, EvidenceChannelRecord, EvidenceManifest } from "@relay/protocol";
import { base, type Device } from "./device.js";
import { now } from "./events.js";
import { redactValue, visualEvidenceAllowed } from "./redaction.js";
import { hasSensitiveEvidenceConsent } from "./evidence-policy.js";
import { ensureRunDir, type RunArtifact } from "./runs.js";
import type { TestJob } from "./session.js";

const CHANNELS: EvidenceChannel[] = [
  "input",
  "screenshot",
  "video",
  "ui-tree",
  "logs",
  "network",
  "performance",
  "crash",
  "audio",
];

export type RunEvidenceHandle = {
  startedAt: number;
  monotonicStart: number;
  recordingStarted: boolean;
  logsStarted: boolean;
  audioStarted: boolean;
  crashStarted: boolean;
  stopped: boolean;
  manifest: EvidenceManifest;
};

export function initializeRunEvidence(job: TestJob): RunEvidenceHandle {
  const startedAt = now();
  const handle: RunEvidenceHandle = {
    startedAt,
    monotonicStart: performance.now(),
    recordingStarted: false,
    logsStarted: false,
    audioStarted: false,
    crashStarted: false,
    stopped: false,
    manifest: createManifest(job, startedAt),
  };
  job.evidence = handle.manifest;
  channel(handle, "input").status = "captured";
  channel(handle, "input").startedAt = startedAt;
  channel(handle, "screenshot").status = "partial";
  channel(handle, "screenshot").startedAt = startedAt;
  channel(handle, "ui-tree").status = "partial";
  channel(handle, "ui-tree").startedAt = startedAt;
  if (!visualEvidenceAllowed()) {
    for (const name of ["screenshot", "video", "ui-tree"] as const) {
      const record = channel(handle, name);
      record.status = "redacted";
      record.startedAt = startedAt;
      record.redactions = 1;
      record.message = "disabled because visual content cannot be safely redacted";
    }
  }
  const crash = channel(handle, "crash");
  crash.status = "denied";
  crash.message = "crash diagnostics require an explicit workspace consent grant";
  const audio = channel(handle, "audio");
  audio.status = "denied";
  audio.message = "audio probing requires an explicit workspace consent grant";
  for (const [name, grant] of Object.entries(job.evidencePolicy.sensitive)) {
    const channelName: EvidenceChannel =
      name === "network-body" ? "network" : (name as EvidenceChannel);
    event(handle, channelName, "consent.granted", {
      sensitiveChannel: name,
      grant,
    });
  }
  event(handle, "input", "run.started", { target: handle.manifest.target });
  return handle;
}

function emptyChannel(channel: EvidenceChannel): EvidenceChannelRecord {
  return {
    channel,
    status: "unsupported",
    entries: 0,
    bytes: 0,
    dropped: 0,
    redactions: 0,
  };
}

function createManifest(job: TestJob, startedAt: number): EvidenceManifest {
  return {
    schemaVersion: 1,
    runId: job.id,
    target: {
      kind: job.targetKind ?? "device",
      platform: job.targetKind === "browser" ? "browser" : job.platform,
      ...(job.browserTargetId || job.serial ? { id: job.browserTargetId ?? job.serial } : {}),
      ...(job.targetProfile ? { profileId: job.targetProfile.id } : {}),
    },
    startedAt,
    collectionPolicy: structuredClone(job.evidencePolicy),
    channels: Object.fromEntries(
      CHANNELS.map((channel) => [channel, emptyChannel(channel)]),
    ) as Record<EvidenceChannel, EvidenceChannelRecord>,
    events: [],
  };
}

function channel(handle: RunEvidenceHandle, name: EvidenceChannel): EvidenceChannelRecord {
  return handle.manifest.channels[name];
}

function event(
  handle: RunEvidenceHandle,
  name: EvidenceChannel,
  kind: string,
  data?: unknown,
  stepId?: string,
): void {
  handle.manifest.events.push({
    sequence: handle.manifest.events.length + 1,
    at: now(),
    monotonicMs: Math.max(0, performance.now() - handle.monotonicStart),
    channel: name,
    kind,
    ...(stepId ? { stepId } : {}),
    ...(data === undefined ? {} : { data: redactValue(data) }),
  });
}

function addArtifact(job: TestJob, artifact: RunArtifact): void {
  job.artifacts.push(artifact);
}

function failed(
  handle: RunEvidenceHandle,
  name: EvidenceChannel,
  error: unknown,
  log: (line: string) => void,
): void {
  const record = channel(handle, name);
  record.message = messageOf(error);
  record.status = /unsupported|unavailable|requires a selected|capability/i.test(record.message)
    ? "unsupported"
    : "failed";
  record.finishedAt = now();
  event(handle, name, "capture.failed", { message: record.message });
  log(`warn: ${name} evidence unavailable: ${record.message}`);
}

/** Start bounded automatic collectors. Their failures are recorded, not promoted to test failures. */
export async function startRunEvidence(
  job: TestJob,
  device: Device,
  log: (line: string) => void,
  existing?: RunEvidenceHandle,
): Promise<RunEvidenceHandle> {
  const handle = existing ?? initializeRunEvidence(job);
  const startedAt = handle.startedAt;

  try {
    const performanceResult = await withTimeout(
      device.observability.perf({ ...base() }),
      5_000,
      "performance capture",
    );
    const record = channel(handle, "performance");
    record.status = "captured";
    record.startedAt = startedAt;
    record.entries += 1;
    addArtifact(job, {
      kind: "performance-start",
      capturedAt: now(),
      data: redactValue(performanceResult),
    });
    event(handle, "performance", "sample", performanceResult);
  } catch (error) {
    failed(handle, "performance", error, log);
  }

  try {
    await withTimeout(
      device.observability.logs({ ...base(), action: "start" }),
      5_000,
      "log capture start",
      async () => {
        await device.observability.logs({ ...base(), action: "stop" });
      },
    );
    const record = channel(handle, "logs");
    record.status = "captured";
    record.startedAt = startedAt;
    handle.logsStarted = true;
    event(handle, "logs", "capture.started");
  } catch (error) {
    failed(handle, "logs", error, log);
  }

  try {
    const include = hasSensitiveEvidenceConsent(job.evidencePolicy, "network-body")
      ? "all"
      : "summary";
    await withTimeout(
      device.observability.network({ ...base(), action: "log", include, limit: 1_000 }),
      5_000,
      "network capture start",
    );
    const record = channel(handle, "network");
    record.status = "captured";
    record.startedAt = startedAt;
    record.message = include === "all" ? "request and response bodies consented" : "summary only";
    event(handle, "network", "capture.started", { include });
  } catch (error) {
    failed(handle, "network", error, log);
  }

  if (hasSensitiveEvidenceConsent(job.evidencePolicy, "crash")) {
    try {
      await withTimeout(
        device.observability.crashes({ action: "start", since: startedAt }),
        5_000,
        "crash diagnostics start",
        async () => {
          await device.observability.crashes({ action: "dump", since: startedAt });
        },
      );
      const record = channel(handle, "crash");
      record.status = "captured";
      record.startedAt = startedAt;
      record.message = undefined;
      handle.crashStarted = true;
      event(handle, "crash", "capture.started");
    } catch (error) {
      failed(handle, "crash", error, log);
    }
  }

  if (hasSensitiveEvidenceConsent(job.evidencePolicy, "audio")) {
    try {
      const result = await withTimeout(
        device.observability.audio({
          ...base(),
          action: "probe",
          probeAction: "start",
          bucketMs: 250,
        }),
        5_000,
        "audio probe start",
        async () => {
          await device.observability.audio({ ...base(), action: "probe", probeAction: "stop" });
        },
      );
      const record = channel(handle, "audio");
      record.status = "captured";
      record.startedAt = startedAt;
      record.message = undefined;
      handle.audioStarted = true;
      addArtifact(job, { kind: "audio-start", capturedAt: now(), data: redactValue(result) });
      event(handle, "audio", "capture.started", result);
    } catch (error) {
      failed(handle, "audio", error, log);
    }
  }

  if (visualEvidenceAllowed()) {
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
        async () => {
          await device.recording.record({ ...base(), action: "stop" });
        },
      );
      if (result && typeof result === "object" && "started" in result && result.started === false) {
        const warning =
          "warning" in result && typeof result.warning === "string"
            ? result.warning
            : "Video recording is unavailable";
        const record = channel(handle, "video");
        record.status = "unsupported";
        record.message = warning;
        log(`warn: ${warning}`);
      } else {
        handle.recordingStarted = true;
        const record = channel(handle, "video");
        record.status = "captured";
        record.startedAt = startedAt;
        addArtifact(job, {
          kind: "video-start",
          capturedAt: startedAt,
          data: { path: "video/run.mp4", result: redactValue(result) },
        });
        event(handle, "video", "capture.started", { path: "video/run.mp4" });
        log("evidence: video recording started");
      }
    } catch (error) {
      failed(handle, "video", error, log);
    }
  }

  return handle;
}

export async function stopRunEvidence(
  handle: RunEvidenceHandle | undefined,
  job: TestJob,
  device: Device | undefined,
  log: (line: string) => void,
): Promise<void> {
  if (!handle || handle.stopped) return;
  handle.stopped = true;

  if (device) {
    try {
      const performanceResult = await withTimeout(
        device.observability.perf({ ...base() }),
        5_000,
        "performance capture",
      );
      const record = channel(handle, "performance");
      record.status = record.status === "failed" ? "partial" : "captured";
      record.entries += 1;
      record.finishedAt = now();
      addArtifact(job, {
        kind: "performance-end",
        capturedAt: now(),
        data: redactValue(performanceResult),
      });
      event(handle, "performance", "sample", performanceResult);
    } catch (error) {
      failed(handle, "performance", error, log);
    }

    if (handle.logsStarted) {
      try {
        const result = await withTimeout(
          device.observability.logs({ ...base(), action: "stop" }),
          5_000,
          "log capture stop",
        );
        const data = redactValue(result);
        addArtifact(job, { kind: "logs", capturedAt: now(), data });
        const entries = entryCount(result);
        const record = channel(handle, "logs");
        record.entries = entries;
        record.bytes = byteCount(data);
        record.dropped = droppedCount(result);
        if (record.dropped > 0) record.status = "partial";
        record.finishedAt = now();
        event(handle, "logs", "capture.stopped", { entries });
      } catch (error) {
        failed(handle, "logs", error, log);
      }
    }

    try {
      const result = await withTimeout(
        device.observability.network({
          ...base(),
          action: "dump",
          include: hasSensitiveEvidenceConsent(job.evidencePolicy, "network-body")
            ? "all"
            : "summary",
          limit: 1_000,
        }),
        5_000,
        "network capture",
      );
      const data = redactValue(result);
      addArtifact(job, { kind: "network", capturedAt: now(), data });
      const record = channel(handle, "network");
      record.status = "captured";
      record.startedAt = handle.startedAt;
      record.finishedAt = now();
      record.entries = entryCount(result);
      record.bytes = byteCount(data);
      record.dropped = droppedCount(result);
      if (record.dropped > 0) record.status = "partial";
      event(handle, "network", "capture.stopped", { entries: record.entries });
    } catch (error) {
      failed(handle, "network", error, log);
    }

    if (handle.crashStarted) {
      try {
        const result = await withTimeout(
          device.observability.crashes({ action: "dump", since: handle.startedAt }),
          10_000,
          "crash diagnostics",
        );
        const data = redactValue(result);
        addArtifact(job, { kind: "crash", capturedAt: now(), data });
        const record = channel(handle, "crash");
        record.entries = result.entries.length;
        record.bytes = byteCount(data);
        record.dropped = result.truncated ? 1 : 0;
        record.status = result.truncated ? "partial" : "captured";
        record.finishedAt = now();
        event(handle, "crash", "capture.stopped", {
          entries: record.entries,
          truncated: result.truncated,
        });
      } catch (error) {
        failed(handle, "crash", error, log);
      }
    }

    if (handle.audioStarted) {
      try {
        const result = await withTimeout(
          device.observability.audio({ ...base(), action: "probe", probeAction: "stop" }),
          10_000,
          "audio probe stop",
        );
        const data = redactValue(result);
        addArtifact(job, { kind: "audio", capturedAt: now(), data });
        const record = channel(handle, "audio");
        record.entries = entryCount(result);
        record.bytes = byteCount(data);
        record.status = "captured";
        record.finishedAt = now();
        event(handle, "audio", "capture.stopped", { entries: record.entries });
      } catch (error) {
        failed(handle, "audio", error, log);
      }
    }

    if (handle.recordingStarted) {
      try {
        const result = await withTimeout(
          device.recording.record({ ...base(), action: "stop" }),
          10_000,
          "video recorder stop",
        );
        const files = await videoFiles(job);
        const record = channel(handle, "video");
        record.finishedAt = now();
        record.entries = files.length;
        record.bytes = files.reduce((sum, file) => sum + file.bytes, 0);
        if (files.length === 0) {
          record.status = "partial";
          record.message = "recorder stopped without a video file";
        }
        addArtifact(job, {
          kind: "video",
          capturedAt: now(),
          data: {
            startedAt: handle.startedAt,
            stoppedAt: now(),
            durationMs: Math.max(0, now() - handle.startedAt),
            files,
            result: redactValue(result),
          },
        });
        event(handle, "video", "capture.stopped", { files });
        log(
          files.length > 0
            ? "evidence: video saved"
            : "warn: recorder stopped without a video file",
        );
      } catch (error) {
        failed(handle, "video", error, log);
      }
    }
  } else {
    for (const name of ["performance", "logs", "network", "video", "crash", "audio"] as const) {
      if (
        channel(handle, name).status !== "unsupported" &&
        channel(handle, name).status !== "redacted"
      ) {
        channel(handle, name).status = "partial";
        channel(handle, name).message = "target adapter became unavailable before finalization";
      }
    }
  }

  for (const step of job.steps) {
    for (const action of step.actions ?? []) {
      event(handle, "input", action.kind, { label: action.label }, step.id);
    }
    for (const frame of step.frames) {
      event(handle, "screenshot", "frame", { path: frame.path, bytes: frame.bytes }, step.id);
    }
  }
  const treeArtifacts = job.artifacts.filter((artifact) => artifact.kind === "ui-tree");
  for (const artifact of treeArtifacts) {
    const data = artifact.data as { stepId?: string; phase?: string; nodes?: unknown[] };
    event(
      handle,
      "ui-tree",
      `snapshot.${data.phase ?? "unknown"}`,
      { nodes: data.nodes?.length ?? 0 },
      data.stepId,
    );
  }
  for (const artifact of job.artifacts.filter((item) => item.kind === "command-attempt")) {
    const data = artifact.data as { stepId?: string; command?: unknown };
    event(handle, "input", "command.attempt", data.command, data.stepId);
  }
  const screenshots = channel(handle, "screenshot");
  screenshots.entries = job.frames.length;
  screenshots.bytes = job.frames.reduce((sum, frame) => sum + (frame.bytes ?? 0), 0);
  if (screenshots.status !== "redacted") {
    screenshots.status = screenshots.entries > 0 ? "captured" : "partial";
  }
  screenshots.finishedAt = now();
  const input = channel(handle, "input");
  input.entries = handle.manifest.events.filter((item) => item.channel === "input").length;
  input.finishedAt = now();
  const trees = channel(handle, "ui-tree");
  trees.entries = treeArtifacts.length;
  trees.bytes = byteCount(treeArtifacts.map((artifact) => artifact.data));
  if (trees.status !== "redacted") {
    trees.status = treeArtifacts.length > 0 ? "captured" : "partial";
  }
  trees.finishedAt = now();
  handle.manifest.finishedAt = now();
  event(handle, "input", "run.finished");
  job.evidence = handle.manifest;
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

function entryCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && "entries" in value) {
    const entries = (value as { entries?: unknown }).entries;
    return Array.isArray(entries) ? entries.length : 0;
  }
  return value === undefined || value === null ? 0 : 1;
}

function byteCount(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}

function droppedCount(value: unknown): number {
  if (!value || typeof value !== "object" || !("dropped" in value)) return 0;
  const dropped = (value as { dropped?: unknown }).dropped;
  return typeof dropped === "number" && dropped > 0 ? dropped : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onLateResolve?: (value: T) => void | Promise<void>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const tracked = promise.then(async (value) => {
    if (timedOut && onLateResolve) await onLateResolve(value);
    return value;
  });
  try {
    return await Promise.race([
      tracked,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`${label} timed out`));
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
