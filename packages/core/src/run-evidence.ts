import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceChannel, EvidenceChannelRecord, EvidenceManifest } from "@relay/protocol";
import { base, type Device } from "./device.js";
import { now } from "./events.js";
import { redactValue, visualEvidenceAllowed } from "./redaction.js";
import { hasSensitiveEvidenceConsent } from "./evidence-policy.js";
import { ensureRunDir, type RunArtifact } from "./runs.js";
import type { TestJob } from "./session.js";
import { captureAndroidForegroundApp } from "./android-ui-snapshot.js";

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

// Android screenrecord finalizes the container on-device before pulling and
// validating it. That work legitimately outlives the SDK's ten-second signal
// grace on some physical Samsung builds, so Relay must not abandon ownership
// while the recorder is still cleaning up.
const VIDEO_RECORDER_STOP_TIMEOUT_MS = 25_000;

export type RunEvidenceHandle = {
  startedAt: number;
  monotonicStart: number;
  recordingStarted: boolean;
  performanceStarted: boolean;
  logsStarted: boolean;
  networkStarted: boolean;
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
    performanceStarted: false,
    logsStarted: false,
    networkStarted: false,
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
  timing?: { at?: number; monotonicMs?: number },
): void {
  const capturedAt = finiteTimestamp(timing?.at) ?? now();
  const monotonicMs =
    finiteOffset(timing?.monotonicMs) ??
    (timing?.at === undefined
      ? Math.max(0, performance.now() - handle.monotonicStart)
      : Math.max(0, capturedAt - handle.startedAt));
  handle.manifest.events.push({
    sequence: handle.manifest.events.length + 1,
    at: capturedAt,
    monotonicMs,
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

function unsupported(
  handle: RunEvidenceHandle,
  name: EvidenceChannel,
  message: string,
  log: (line: string) => void,
): void {
  const record = channel(handle, name);
  record.status = "unsupported";
  record.message = message;
  record.finishedAt = now();
  event(handle, name, "capture.unsupported", { message });
  log(`evidence: ${name} skipped — ${message}`);
}

export type RunEvidenceOptions = {
  /** A physical Apple target shares one XCTest process for observation and
   * control. Starting simulator-style collectors would block that process and
   * can destroy the app state that the flow is about to verify. */
  physicalIos?: boolean;
  /** Override foreground-app discovery in tests or embedded hosts. */
  foregroundAppResolver?: (serial: string) => Promise<string | undefined>;
};

/**
 * Android observability is session-scoped in agent-device. A screenshot can
 * still work through the raw/device path when no SDK session exists, which
 * made an otherwise healthy run look complete while logs, network, and
 * performance quietly failed with "no active session". Prime the same SDK
 * client before starting those collectors so all evidence shares one runtime
 * binding. The snapshot is deliberately not added to the run: it is a
 * transport warm-up, not user-visible evidence.
 */
async function primeAndroidEvidenceSession(
  job: TestJob,
  device: Device,
  handle: RunEvidenceHandle,
  log: (line: string) => void,
  foregroundAppResolver: (
    serial: string,
  ) => Promise<string | undefined> = captureAndroidForegroundApp,
): Promise<void> {
  if (job.targetKind === "browser" || job.platform !== "android" || !job.serial) return;

  try {
    let appPackage: string | undefined;
    if (device.command?.appState) {
      try {
        const state = await withTimeout(
          device.command.appState({ ...base() }),
          3_000,
          "Android foreground app",
        );
        if ("package" in state && typeof state.package === "string") {
          const candidate = state.package.trim();
          // Do not accidentally bind evidence to the launcher or system UI
          // when a person starts a run from the home screen.
          if (candidate && !/(?:launcher|systemui)$/i.test(candidate)) appPackage = candidate;
        }
      } catch {
        // Snapshot remains a useful session warm-up even when foreground-app
        // inspection is unavailable on a particular Android build.
      }
    }
    // `command.appState` is session-scoped. A freshly created client can
    // legitimately return no app even while a physical phone is showing one.
    // Ask Android which package owns the pixels before starting collectors so
    // logs/perf/network attach to the same app as the run.
    if (!appPackage) {
      const foreground = await withTimeout(
        foregroundAppResolver(job.serial),
        2_500,
        "Android foreground app discovery",
      ).catch(() => undefined);
      if (foreground && !/(?:launcher|systemui|inputmethod|keyboard)$/i.test(foreground)) {
        appPackage = foreground;
      }
    }
    if (appPackage && device.apps?.open) {
      await withTimeout(
        device.apps.open({
          ...base(),
          app: appPackage,
          relaunch: false,
          noRecord: true,
        }),
        5_000,
        "Android app session",
      );
      event(handle, "input", "app.session.bound", { platform: "android", app: appPackage });
      log(`evidence: Android app session bound to ${appPackage}`);
    }
    const result = await withTimeout(
      device.capture.snapshot({ ...base(), interactiveOnly: false }),
      5_000,
      "Android evidence session",
    );
    const nodes = Array.isArray(result?.nodes) ? result.nodes.length : 0;
    event(handle, "input", "session.primed", { platform: "android", nodes });
    log(
      nodes > 0
        ? `evidence: Android session ready (${nodes} UI nodes observed)`
        : "evidence: Android session ready (UI tree unavailable)",
    );
  } catch (error) {
    // Evidence is additive. Keep the run usable and make the limitation
    // explicit instead of turning a collector problem into a test failure.
    log(
      `warn: Android evidence session could not be primed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Start bounded automatic collectors. Their failures are recorded, not promoted to test failures. */
export async function startRunEvidence(
  job: TestJob,
  device: Device,
  log: (line: string) => void,
  existing?: RunEvidenceHandle,
  options: RunEvidenceOptions = {},
): Promise<RunEvidenceHandle> {
  const handle = existing ?? initializeRunEvidence(job);
  const startedAt = handle.startedAt;

  await primeAndroidEvidenceSession(job, device, handle, log, options.foregroundAppResolver);

  if (options.physicalIos) {
    unsupported(handle, "performance", "not available from the physical iOS runner", log);
  } else
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
      handle.performanceStarted = true;
      addArtifact(job, {
        kind: "performance-start",
        capturedAt: now(),
        data: redactValue(performanceResult),
      });
      event(handle, "performance", "sample", performanceResult);
    } catch (error) {
      failed(handle, "performance", error, log);
    }

  if (options.physicalIos) {
    unsupported(handle, "logs", "not available from the physical iOS runner", log);
  } else
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

  if (options.physicalIos) {
    unsupported(handle, "network", "requires an instrumented app or proxy on physical iOS", log);
  } else
    try {
      const include = hasSensitiveEvidenceConsent(job.evidencePolicy, "network-body")
        ? "all"
        : "summary";
      await withTimeout(
        device.observability.network({ ...base(), action: "log", include, limit: 200 }),
        5_000,
        "network capture start",
      );
      const record = channel(handle, "network");
      record.status = "captured";
      record.startedAt = startedAt;
      record.message = include === "all" ? "request and response bodies consented" : "summary only";
      handle.networkStarted = true;
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

  if (visualEvidenceAllowed() && !options.physicalIos) {
    try {
      const runDir = await ensureRunDir(job);
      const path = join(runDir, "video", "run.mp4");
      const result = await withTimeout(
        device.recording.record({
          ...base(),
          action: "start",
          path,
          fps: 30,
          // Screenshots carry pixel-level evidence. Medium H.264 keeps the
          // continuous run review sharp without producing huge device files.
          quality: "medium",
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
  } else if (visualEvidenceAllowed() && options.physicalIos) {
    unsupported(
      handle,
      "video",
      "full-flow video is unavailable; recorded transitions keep their own takes",
      log,
    );
  }

  return handle;
}

async function stopVideoEvidence(
  handle: RunEvidenceHandle,
  job: TestJob,
  device: Device,
  log: (line: string) => void,
): Promise<void> {
  if (!handle.recordingStarted) return;
  try {
    const result = await withTimeout(
      device.recording.record({ ...base(), action: "stop" }),
      VIDEO_RECORDER_STOP_TIMEOUT_MS,
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
    log(files.length > 0 ? "evidence: video saved" : "warn: recorder stopped without a video file");
  } catch (error) {
    failed(handle, "video", error, log);
  }
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
    // End the visual proof at the test boundary. Logs and performance can
    // finalize afterwards without adding seconds of an idle screen to video.
    await stopVideoEvidence(handle, job, device, log);

    if (handle.performanceStarted)
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

    if (handle.networkStarted)
      try {
        const result = await withTimeout(
          device.observability.network({
            ...base(),
            action: "dump",
            include: hasSensitiveEvidenceConsent(job.evidencePolicy, "network-body")
              ? "all"
              : "summary",
            limit: 200,
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
      event(handle, "input", action.kind, { label: action.label }, step.id, { at: action.at });
    }
    for (const frame of step.frames) {
      event(handle, "screenshot", "frame", { path: frame.path, bytes: frame.bytes }, step.id, {
        at: frame.capturedAt,
      });
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
      { at: artifact.capturedAt },
    );
  }
  for (const artifact of job.artifacts.filter((item) => item.kind === "command-attempt")) {
    const data = artifact.data as { stepId?: string; command?: unknown };
    event(handle, "input", "command.attempt", data.command, data.stepId, {
      at: artifact.capturedAt,
    });
  }
  const screenshots = channel(handle, "screenshot");
  screenshots.entries = job.frames.length;
  screenshots.bytes = job.frames.reduce((sum, frame) => sum + (frame.bytes ?? 0), 0);
  if (screenshots.status !== "redacted") {
    screenshots.status = screenshots.entries > 0 ? "captured" : "partial";
  }
  screenshots.finishedAt = now();
  const trees = channel(handle, "ui-tree");
  trees.entries = treeArtifacts.length;
  trees.bytes = byteCount(treeArtifacts.map((artifact) => artifact.data));
  if (trees.status !== "redacted") {
    trees.status = treeArtifacts.length > 0 ? "captured" : "partial";
  }
  trees.finishedAt = now();
  handle.manifest.finishedAt = now();
  event(handle, "input", "run.finished", undefined, undefined, {
    at: handle.manifest.finishedAt,
  });
  resequenceChronologically(handle.manifest);
  const input = channel(handle, "input");
  input.entries = handle.manifest.events.filter((item) => item.channel === "input").length;
  input.finishedAt = handle.manifest.finishedAt;
  job.evidence = handle.manifest;
}

function finiteTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finiteOffset(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function resequenceChronologically(manifest: EvidenceManifest): void {
  manifest.events.sort(
    (left, right) => left.monotonicMs - right.monotonicMs || left.sequence - right.sequence,
  );
  for (const [index, item] of manifest.events.entries()) item.sequence = index + 1;
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
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
