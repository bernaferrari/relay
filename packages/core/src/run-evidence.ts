import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceChannel, EvidenceChannelRecord, EvidenceManifest } from "@relay/protocol";
import { base, bindAndroidAppSession, recordDeviceVideo, type Device } from "./device.js";
import { now } from "./events.js";
import { redactValue, visualEvidenceAllowed } from "./redaction.js";
import { hasSensitiveEvidenceConsent } from "./evidence-policy.js";
import { ensureRunDir, type RunArtifact } from "./runs.js";
import type { TestJob } from "./session.js";
import { captureAndroidForegroundApp } from "./android-ui-snapshot.js";
import { captureBrowserProofEvidence } from "./browser-proof-evidence-runtime.js";

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

/** Cancellation tears down the native control session before terminal
 * persistence. Never reuse that adapter for collector finalization; the
 * handle still folds buffered frames, trees, actions, and command attempts. */
export function runEvidenceFinalizationDevice(
  status: TestJob["status"],
  device: Device | undefined,
): Device | undefined {
  return status === "cancelled" ? undefined : device;
}

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
    ...(job.sourceRevision ? { sourceRevision: job.sourceRevision } : {}),
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

async function stopBrowserProofEvidence(job: TestJob, log: (line: string) => void): Promise<void> {
  if (job.targetKind !== "browser" || !job.browserTargetId) return;
  const targetProfile = job.targetProfile;
  const environment = job.browserCaseProfile ?? targetProfile?.browserCaseProfile;
  const sourceRevision = job.sourceRevision;
  if (!targetProfile?.id || !environment || !sourceRevision?.artifactDigest) {
    log("warn: browser proof evidence unavailable: frozen target/build identity is incomplete");
    return;
  }
  try {
    const evidence = await captureBrowserProofEvidence({
      targetId: job.browserTargetId,
      runId: job.id,
      targetProfileId: targetProfile.id,
      sourceSha: sourceRevision.sha,
      artifactDigest: sourceRevision.artifactDigest,
      environment,
      runDir: await ensureRunDir(job),
    });
    addArtifact(job, {
      kind: "browser-proof-evidence",
      capturedAt: now(),
      data: evidence,
    });
    log(
      evidence.completeness.status === "complete"
        ? "evidence: browser proof channels captured"
        : `warn: browser proof evidence partial (${evidence.completeness.missing.join(", ")})`,
    );
  } catch (error) {
    log(
      `warn: browser proof evidence unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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

/**
 * One guard per collector attempt: a collector's failure is folded into its
 * evidence record, never promoted to a test failure. Shared by the start and
 * stop paths so the swallowing semantics exist exactly once.
 */
async function guardedCollector(
  handle: RunEvidenceHandle,
  name: EvidenceChannel,
  log: (line: string) => void,
  collect: () => Promise<void>,
  unsupportedReason?: string,
): Promise<void> {
  if (unsupportedReason !== undefined) {
    unsupported(handle, name, unsupportedReason, log);
    return;
  }
  try {
    await collect();
  } catch (error) {
    failed(handle, name, error, log);
  }
}

type CollectorStartedFlag =
  | "recordingStarted"
  | "performanceStarted"
  | "logsStarted"
  | "networkStarted"
  | "audioStarted"
  | "crashStarted";

type InstrumentedChannel = Exclude<EvidenceChannel, "input" | "screenshot" | "ui-tree">;

const COLLECTOR_STARTED_FLAG: Record<InstrumentedChannel, CollectorStartedFlag> = {
  video: "recordingStarted",
  performance: "performanceStarted",
  logs: "logsStarted",
  network: "networkStarted",
  crash: "crashStarted",
  audio: "audioStarted",
};

/** Shared tail of every successful collector start: mark the channel
 * captured at the run's start instant and latch its handle flag. */
function markCollectorStarted(
  handle: RunEvidenceHandle,
  name: InstrumentedChannel,
  extras: { countEntry?: boolean; message?: string; clearMessage?: boolean } = {},
): void {
  const record = channel(handle, name);
  record.status = "captured";
  record.startedAt = handle.startedAt;
  if (extras.countEntry === true) record.entries += 1;
  if (extras.message !== undefined || extras.clearMessage === true) record.message = extras.message;
  handle[COLLECTOR_STARTED_FLAG[name]] = true;
}

/** Persist a dumped capture as a redacted artifact and fold its stats into
 * the channel record, demoting it to partial when entries were dropped —
 * the common tail of every stop-path collector. */
async function persistCaptureArtifact(
  job: TestJob,
  record: EvidenceChannelRecord,
  kind: string,
  result: unknown,
  dropped = 0,
): Promise<void> {
  const data = redactValue(result);
  addArtifact(job, { kind, capturedAt: now(), data });
  record.entries = entryCount(result);
  record.bytes = byteCount(data);
  record.dropped = dropped;
  if (dropped > 0) record.status = "partial";
  record.finishedAt = now();
}

export type RunEvidenceOptions = {
  /** A physical Apple target shares one XCTest process for observation and
   * control. Starting simulator-style collectors would block that process and
   * can destroy the app state that the flow is about to verify. */
  physicalIos?: boolean;
  /** Override foreground-app discovery in tests or embedded hosts. */
  foregroundAppResolver?: (serial: string) => Promise<string | undefined>;
};

function hasStepScopedCampaignEvidence(job: TestJob): boolean {
  return job.recipeSnapshot?.steps.some((step) => Boolean(step.check)) === true;
}

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
    if (appPackage) {
      await withTimeout(
        bindAndroidAppSession(device, appPackage, job.serial),
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

  await guardedCollector(
    handle,
    "performance",
    log,
    async () => {
      const performanceResult = await withTimeout(
        device.observability.perf({ ...base() }),
        5_000,
        "performance capture",
      );
      markCollectorStarted(handle, "performance", { countEntry: true });
      addArtifact(job, {
        kind: "performance-start",
        capturedAt: now(),
        data: redactValue(performanceResult),
      });
      event(handle, "performance", "sample", performanceResult);
    },
    options.physicalIos ? "not available from the physical iOS runner" : undefined,
  );

  await guardedCollector(
    handle,
    "logs",
    log,
    async () => {
      await withTimeout(
        device.observability.logs({ ...base(), action: "start" }),
        5_000,
        "log capture start",
        async () => {
          await device.observability.logs({ ...base(), action: "stop" });
        },
      );
      markCollectorStarted(handle, "logs");
      event(handle, "logs", "capture.started");
    },
    options.physicalIos ? "not available from the physical iOS runner" : undefined,
  );

  await guardedCollector(
    handle,
    "network",
    log,
    async () => {
      const include = hasSensitiveEvidenceConsent(job.evidencePolicy, "network-body")
        ? "all"
        : "summary";
      await withTimeout(
        device.observability.network({ ...base(), action: "log", include, limit: 200 }),
        5_000,
        "network capture start",
      );
      markCollectorStarted(handle, "network", {
        message: include === "all" ? "request and response bodies consented" : "summary only",
      });
      event(handle, "network", "capture.started", { include });
    },
    options.physicalIos ? "requires an instrumented app or proxy on physical iOS" : undefined,
  );

  if (hasSensitiveEvidenceConsent(job.evidencePolicy, "crash")) {
    await guardedCollector(handle, "crash", log, async () => {
      await withTimeout(
        device.observability.crashes({ action: "start", since: startedAt }),
        5_000,
        "crash diagnostics start",
        async () => {
          await device.observability.crashes({ action: "dump", since: startedAt });
        },
      );
      markCollectorStarted(handle, "crash", { clearMessage: true });
      event(handle, "crash", "capture.started");
    });
  }

  if (hasSensitiveEvidenceConsent(job.evidencePolicy, "audio")) {
    await guardedCollector(handle, "audio", log, async () => {
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
      markCollectorStarted(handle, "audio", { clearMessage: true });
      addArtifact(job, { kind: "audio-start", capturedAt: now(), data: redactValue(result) });
      event(handle, "audio", "capture.started", result);
    });
  }

  const videoUnsupported = visualEvidenceAllowed()
    ? hasStepScopedCampaignEvidence(job)
      ? "step-scoped campaign frames already provide reviewable visual evidence"
      : options.physicalIos
        ? "full-flow video is unavailable; recorded transitions keep their own takes"
        : undefined
    : undefined;
  await guardedCollector(
    handle,
    "video",
    log,
    async () => {
      const runDir = await ensureRunDir(job);
      const path = join(runDir, "video", "run.mp4");
      const result = await withTimeout(
        recordDeviceVideo(device, {
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
          await recordDeviceVideo(device, { ...base(), action: "stop" });
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
        markCollectorStarted(handle, "video");
        addArtifact(job, {
          kind: "video-start",
          capturedAt: startedAt,
          data: { path: "video/run.mp4", result: redactValue(result) },
        });
        event(handle, "video", "capture.started", { path: "video/run.mp4" });
        log("evidence: video recording started");
      }
    },
    videoUnsupported,
  );

  return handle;
}

async function stopVideoEvidence(
  handle: RunEvidenceHandle,
  job: TestJob,
  device: Device,
  log: (line: string) => void,
): Promise<void> {
  if (!handle.recordingStarted) return;
  await guardedCollector(handle, "video", log, async () => {
    const result = await withTimeout(
      recordDeviceVideo(device, { ...base(), action: "stop" }),
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
  });
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
      await guardedCollector(handle, "performance", log, async () => {
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
      });

    if (handle.logsStarted) {
      await guardedCollector(handle, "logs", log, async () => {
        const result = await withTimeout(
          device.observability.logs({ ...base(), action: "stop" }),
          5_000,
          "log capture stop",
        );
        const record = channel(handle, "logs");
        await persistCaptureArtifact(job, record, "logs", result, droppedCount(result));
        event(handle, "logs", "capture.stopped", { entries: record.entries });
      });
    }

    if (handle.networkStarted)
      await guardedCollector(handle, "network", log, async () => {
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
        const record = channel(handle, "network");
        record.status = "captured";
        record.startedAt = handle.startedAt;
        await persistCaptureArtifact(job, record, "network", result, droppedCount(result));
        event(handle, "network", "capture.stopped", { entries: record.entries });
      });

    if (handle.crashStarted) {
      await guardedCollector(handle, "crash", log, async () => {
        const result = await withTimeout(
          device.observability.crashes({ action: "dump", since: handle.startedAt }),
          10_000,
          "crash diagnostics",
        );
        const record = channel(handle, "crash");
        record.status = result.truncated ? "partial" : "captured";
        await persistCaptureArtifact(job, record, "crash", result, result.truncated ? 1 : 0);
        event(handle, "crash", "capture.stopped", {
          entries: record.entries,
          truncated: result.truncated,
        });
      });
    }

    if (handle.audioStarted) {
      await guardedCollector(handle, "audio", log, async () => {
        const result = await withTimeout(
          device.observability.audio({ ...base(), action: "probe", probeAction: "stop" }),
          10_000,
          "audio probe stop",
        );
        const record = channel(handle, "audio");
        record.status = "captured";
        await persistCaptureArtifact(job, record, "audio", result);
        event(handle, "audio", "capture.stopped", { entries: record.entries });
      });
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
  // Browser proof evidence closes over the single Run/Checkpoint boundary,
  // never each recipe step. This keeps Playwright tracing and its artifact
  // identity exactly-once for multi-step Runs.
  await stopBrowserProofEvidence(job, log);
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
    at: job.finishedAt ?? handle.manifest.finishedAt,
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
