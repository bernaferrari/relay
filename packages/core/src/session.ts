/**
 * Test-run sessions with action traces, heal retries, and disk persistence.
 */
import { randomUUID } from "node:crypto";
import { now, publish } from "./events.js";
import {
  getAction,
  isActionId,
  runAction,
  type ActionId,
  type RunActionOptions,
  type RunActionResult,
} from "./actions.js";
import { createDevice } from "./device.js";
import {
  glyphsFromLogLine,
  planForAction,
  type Glyph,
  type TraceFrameRef,
  type TraceStep,
  type StepKind,
  type StepTone,
} from "./trace.js";
import { persistRun, writeFramePng, ensureRunDir } from "./runs.js";
import { PLATFORM } from "./device.js";
import { classifyJobError } from "./report.js";
import {
  JobCancelledError,
  clearControl,
  ensureControl,
  requestCancel,
  requestPause,
  requestResume,
  setExecutingJobId,
  cooperativeCheckpoint,
  throwIfCancelled,
  raceCancel,
  hardStopDeviceSession,
} from "./control.js";

function classifyError(message: string): JobErrorCode {
  return classifyJobError(message) as JobErrorCode;
}

/** Avoid importing workspace (session↔workspace cycle). */
async function resolveDeviceMeta(serial?: string): Promise<{ deviceName?: string }> {
  if (!serial) return {};
  try {
    const client = createDevice();
    const devices = await client.devices.list({ platform: PLATFORM });
    const match = devices.find((d) => {
      const s = d.android?.serial ?? d.identifiers?.serial ?? d.id;
      return s === serial || d.id === serial;
    });
    return { deviceName: match?.name };
  } catch {
    return {};
  }
}

export type JobStatus = "queued" | "running" | "paused" | "ok" | "error" | "healed" | "cancelled";

export type JobErrorCode =
  | "ACTION_FAILED"
  | "DEVICE_MISSING"
  | "UNKNOWN_ACTION"
  | "TIMEOUT"
  | "ACCOUNT_SWITCH_FAILED"
  | "CANCELLED"
  | "INTERNAL";

export type TestJob = {
  id: string;
  action: ActionId;
  serial?: string;
  /** Human device name from agent-device list */
  deviceName?: string;
  platform: "android";
  status: JobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  result?: unknown;
  error?: string;
  errorCode?: JobErrorCode;
  /** Optional app-under-test version if known from the action result. */
  appVersion?: string;
  /** prior failure message if this run self-healed via retry */
  previousError?: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  /** retries this job (or job this retries) */
  retryOf?: string;
  retriedBy?: string;
  steps: TraceStep[];
  frames: TraceFrameRef[];
  glyphs: Glyph[];
  kind: StepKind;
  tone: StepTone;
  title: string;
  runDir?: string;
  persisted?: boolean;
  options?: {
    skipAccountSwitch?: boolean;
    skipRestoreHome?: boolean;
    prodAccountMatch?: string;
  };
};

const jobs = new Map<string, TestJob>();
const jobOrder: string[] = [];
const MAX_JOBS = 100;
let activeJobId: string | null = null;
const queue: string[] = [];
let draining = false;

export function listJobs(limit = 50): TestJob[] {
  return jobOrder
    .slice()
    .reverse()
    .slice(0, limit)
    .map((id) => jobs.get(id)!)
    .filter(Boolean);
}

export function getJob(id: string): TestJob | undefined {
  return jobs.get(id);
}

export function getActiveJob(): TestJob | null {
  return activeJobId ? (jobs.get(activeJobId) ?? null) : null;
}

function remember(job: TestJob): void {
  jobs.set(job.id, job);
  jobOrder.push(job.id);
  while (jobOrder.length > MAX_JOBS) {
    const old = jobOrder.shift();
    if (old) jobs.delete(old);
  }
}

export type EnqueueJobInput = {
  action: string;
  serial?: string;
  skipAccountSwitch?: boolean;
  skipRestoreHome?: boolean;
  prodAccountMatch?: string;
  /** retry a failed job — enables heal if success */
  retryOf?: string;
};

function makeJob(input: EnqueueJobInput, attemptSeed = 1): TestJob {
  if (!isActionId(input.action)) {
    throw new Error(`Unknown action: ${input.action}`);
  }
  const plan = planForAction(input.action);
  const meta = getAction(input.action);
  const parent = input.retryOf ? jobs.get(input.retryOf) : undefined;
  return {
    id: randomUUID(),
    action: input.action,
    serial: input.serial?.trim() || parent?.serial || undefined,
    deviceName: parent?.deviceName,
    platform: "android",
    status: "queued",
    queuedAt: now(),
    logs: [],
    attempts: parent ? parent.attempts + 1 : attemptSeed,
    retryOf: input.retryOf,
    previousError: parent?.error ?? parent?.previousError,
    steps: [],
    frames: [],
    glyphs: plan.glyphs,
    kind: plan.kind,
    tone: plan.tone,
    title: meta?.title ?? input.action,
    options: {
      skipAccountSwitch: input.skipAccountSwitch ?? parent?.options?.skipAccountSwitch,
      skipRestoreHome: input.skipRestoreHome ?? parent?.options?.skipRestoreHome,
      prodAccountMatch: input.prodAccountMatch ?? parent?.options?.prodAccountMatch,
    },
  };
}

export function enqueueJob(input: EnqueueJobInput): TestJob {
  const job = makeJob(input);
  if (input.retryOf) {
    const parent = jobs.get(input.retryOf);
    if (parent) parent.retriedBy = job.id;
  }
  remember(job);
  publish({
    type: "job.queued",
    at: job.queuedAt,
    jobId: job.id,
    action: job.action,
    serial: job.serial,
  });
  queue.push(job.id);
  void drainQueue();
  return job;
}

/** Re-run a failed (or any) job — success after failure marks healed. */
export function retryJob(id: string): TestJob {
  const parent = jobs.get(id);
  if (!parent) throw new Error(`Unknown job: ${id}`);
  return enqueueJob({
    action: parent.action,
    serial: parent.serial,
    skipAccountSwitch: parent.options?.skipAccountSwitch,
    skipRestoreHome: parent.options?.skipRestoreHome,
    prodAccountMatch: parent.options?.prodAccountMatch,
    retryOf: parent.id,
  });
}

function openStep(
  job: TestJob,
  partial: Omit<TraceStep, "id" | "index" | "startedAt" | "frames" | "log"> & {
    log?: string;
    frames?: TraceFrameRef[];
  },
): TraceStep {
  const step: TraceStep = {
    id: randomUUID(),
    index: job.steps.length,
    kind: partial.kind,
    tone: partial.tone,
    title: partial.title,
    glyphs: partial.glyphs,
    startedAt: now(),
    frames: partial.frames ?? [],
    log: partial.log ?? "",
    heal: partial.heal,
    status: partial.status ?? "running",
  };
  job.steps.push(step);
  publish({
    type: "job.step",
    at: step.startedAt,
    jobId: job.id,
    step,
  });
  return step;
}

function finishStep(step: TraceStep, status: TraceStep["status"], extraLog?: string): void {
  step.finishedAt = now();
  step.durationMs = step.finishedAt - step.startedAt;
  step.status = status;
  if (extraLog) step.log = step.log ? `${step.log}\n${extraLog}` : extraLog;
}

function appendStepLog(step: TraceStep | undefined, line: string): void {
  if (!step) return;
  step.log = step.log ? `${step.log}\n${line}` : line;
  // enrich glyphs from live logs
  const inferred = glyphsFromLogLine(line);
  step.glyphs = [...new Set([...step.glyphs, ...inferred])].slice(0, 6);
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      // skipped if cancelled while still queued
      if (!job || job.status === "cancelled") continue;
      await executeJob(id);
    }
  } finally {
    draining = false;
  }
}

function finalizeCancelled(job: TestJob, primary?: TraceStep): void {
  job.finishedAt = now();
  job.status = "cancelled";
  job.error = "Cancelled by user";
  job.errorCode = "CANCELLED";
  if (primary) finishStep(primary, "error", "✗ cancelled");
  publish({
    type: "job.cancelled",
    at: job.finishedAt,
    jobId: job.id,
    action: job.action,
  });
  publish({
    type: "job.finished",
    at: job.finishedAt,
    jobId: job.id,
    action: job.action,
    ok: false,
    error: job.error,
    durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
    cancelled: true,
  });
  void persistRun(job).catch(() => undefined);
}

/**
 * Cancel a queued or in-flight job.
 * Flags cancel immediately and hard-stops the agent-device session so in-flight
 * ADB work is more likely to drop (best-effort).
 */
export function cancelJob(id: string): TestJob {
  const job = jobs.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);

  if (
    job.status === "ok" ||
    job.status === "error" ||
    job.status === "healed" ||
    job.status === "cancelled"
  ) {
    return job;
  }

  requestCancel(id);
  if (job.status === "running" || job.status === "paused") {
    void hardStopDeviceSession();
  }

  if (job.status === "queued") {
    const idx = queue.indexOf(id);
    if (idx >= 0) queue.splice(idx, 1);
    job.startedAt = job.startedAt ?? now();
    finalizeCancelled(job);
    clearControl(id);
    return job;
  }

  job.logs.push("==> cancel requested (hard-stop session)");
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: "==> cancel requested (hard-stop session)",
    level: "info",
  });
  return job;
}

/** Pause a running job (cooperative — takes effect at next sleep/checkpoint). */
export function pauseJob(id: string): TestJob {
  const job = jobs.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  if (job.status !== "running") {
    throw new Error(`Cannot pause job in status ${job.status}`);
  }
  requestPause(id);
  job.status = "paused";
  job.logs.push("==> paused");
  publish({ type: "job.paused", at: now(), jobId: job.id, action: job.action });
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: "==> paused (Esc/Cancel still works)",
    level: "info",
  });
  return job;
}

/** Resume a paused job. */
export function resumeJob(id: string): TestJob {
  const job = jobs.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  if (job.status !== "paused") {
    throw new Error(`Cannot resume job in status ${job.status}`);
  }
  requestResume(id);
  job.status = "running";
  job.logs.push("==> resumed");
  publish({ type: "job.resumed", at: now(), jobId: job.id, action: job.action });
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: "==> resumed",
    level: "info",
  });
  return job;
}

/** Cancel the active job if any. */
export function cancelActiveJob(): TestJob | null {
  const active = getActiveJob();
  if (!active) return null;
  return cancelJob(active.id);
}

async function executeJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === "cancelled") return;

  ensureControl(id);
  setExecutingJobId(id);
  activeJobId = id;
  job.status = "running";
  job.startedAt = now();
  const meta = await resolveDeviceMeta(job.serial);
  if (meta.deviceName) job.deviceName = meta.deviceName;
  await ensureRunDir(job).catch(() => undefined);

  publish({
    type: "job.started",
    at: job.startedAt,
    jobId: job.id,
    action: job.action,
    serial: job.serial,
  });

  if (job.serial) {
    process.env.AGENT_DEVICE_SERIAL = job.serial;
    process.env.ANDROID_SERIAL = job.serial;
  }
  if (job.options?.prodAccountMatch?.trim()) {
    process.env.PROD_ACCOUNT_MATCH = job.options.prodAccountMatch.trim();
  }

  const plan = planForAction(job.action);
  const stepKind = job.retryOf ? ("Healed" as const) : plan.kind;
  const stepTone = job.retryOf ? ("heal" as const) : plan.tone;

  // Fine-grained steps from recipe plan (pause/cancel between phases via checkpoints in device ops)
  const phaseSpecs =
    plan.planned.length > 0 ? plan.planned : [{ title: job.title, glyphs: plan.glyphs as Glyph[] }];

  const phaseSteps: TraceStep[] = phaseSpecs.map((p, i) =>
    openStep(job, {
      kind: stepKind,
      tone: stepTone,
      title: p.title,
      glyphs: (job.retryOf && i === 0 ? (["re", ...p.glyphs] as Glyph[]) : p.glyphs) as Glyph[],
      status: i === 0 ? "running" : undefined,
      log:
        i === 0
          ? job.retryOf
            ? `retry of ${job.retryOf.slice(0, 8)} · attempt ${job.attempts}`
            : `start ${job.action}${job.deviceName ? ` · ${job.deviceName}` : ""}${job.serial ? ` (${job.serial})` : ""}`
          : "",
    }),
  );

  let phaseIdx = 0;
  const currentPhase = () => phaseSteps[Math.min(phaseIdx, phaseSteps.length - 1)];

  const pushLog = (line: string) => {
    job.logs.push(line);
    appendStepLog(currentPhase(), line);
    // Advance phase on major progress markers so pause has clearer boundaries
    if (
      phaseIdx < phaseSteps.length - 1 &&
      (line.startsWith("==>") || /ensure|restore|update|install|login|sign out|chooser/i.test(line))
    ) {
      const cur = phaseSteps[phaseIdx];
      if (cur && cur.status === "running") {
        finishStep(cur, "ok", line);
        phaseIdx += 1;
        const next = phaseSteps[phaseIdx];
        if (next) next.status = "running";
      }
    }
    const level = /FAIL|error|Error|cancel/i.test(line)
      ? ("error" as const)
      : /DONE|success|resumed|paused/i.test(line)
        ? ("success" as const)
        : ("info" as const);
    publish({ type: "job.log", at: now(), jobId: job.id, line, level });
  };

  const primary = () => currentPhase() ?? phaseSteps[0]!;

  try {
    await cooperativeCheckpoint(id);

    const device = createDevice();
    const opts: RunActionOptions = {
      skipAccountSwitch: job.options?.skipAccountSwitch,
      skipRestoreHome: job.options?.skipRestoreHome,
      onLog: (line) => {
        throwIfCancelled(id);
        pushLog(line);
      },
    };

    // Heartbeat: surface cancel even during long SDK calls; hard-stop session
    let pendingCancel: Error | null = null;
    const heartbeat = setInterval(() => {
      try {
        throwIfCancelled(id);
      } catch (err) {
        pendingCancel = err instanceof Error ? err : new Error(String(err));
        void hardStopDeviceSession();
      }
    }, 50);

    let result: RunActionResult;
    try {
      result = await raceCancel(runAction(device, job.action, opts), id);
      if (pendingCancel) throw pendingCancel;
    } finally {
      clearInterval(heartbeat);
    }
    await cooperativeCheckpoint(id);

    job.finishedAt = now();

    if (result.ok) {
      const wasRetry = Boolean(job.retryOf && job.previousError);
      // close any open phases as ok
      for (const s of phaseSteps) {
        if (s.status === "running" || !s.finishedAt) finishStep(s, "ok");
      }
      if (wasRetry) {
        job.status = "healed";
        job.healed = true;
        job.healMessage = `Recovered after failure: ${job.previousError}. Recipe re-ran successfully on attempt ${job.attempts}.`;
        job.tone = "heal";
        job.kind = "Healed";
        const last = phaseSteps[phaseSteps.length - 1]!;
        last.tone = "heal";
        last.kind = "Healed";
        last.heal = job.healMessage;
        finishStep(last, "healed", `✓ healed · ${result.result ?? "ok"}`);
        publish({
          type: "job.healed",
          at: job.finishedAt,
          jobId: job.id,
          action: job.action,
          healMessage: job.healMessage,
        });
      } else {
        job.status = "ok";
        finishStep(primary(), "ok", `✓ ${result.result ?? "ok"}`);
      }
      job.result = result.result;
      job.error = undefined;
      job.errorCode = undefined;
    } else {
      job.status = "error";
      job.error = result.error;
      job.errorCode = classifyError(result.error ?? "failed");
      for (const s of phaseSteps) {
        if (s.status === "running" || !s.finishedAt) finishStep(s, "error");
      }
      finishStep(primary(), "error", `✗ ${result.error}`);
    }

    publish({
      type: "job.finished",
      at: job.finishedAt,
      jobId: job.id,
      action: job.action,
      ok: result.ok,
      result: job.result,
      error: job.error,
      durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
      healed: job.healed,
    });

    await persistRun(job).catch((err) =>
      pushLog(`warn: persist run failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  } catch (err) {
    if (
      err instanceof JobCancelledError ||
      (err instanceof Error && err.name === "JobCancelledError")
    ) {
      pushLog("==> CANCELLED");
      for (const s of phaseSteps) {
        if (s.status === "running" || !s.finishedAt) finishStep(s, "error", "✗ cancelled");
      }
      finalizeCancelled(job, primary());
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    job.finishedAt = now();
    job.status = "error";
    job.error = message;
    job.errorCode = classifyError(message);
    for (const s of phaseSteps) {
      if (s.status === "running" || !s.finishedAt) finishStep(s, "error");
    }
    finishStep(primary(), "error", `✗ ${message}`);
    pushLog(`==> FAIL: ${message}`);
    publish({
      type: "job.finished",
      at: job.finishedAt,
      jobId: job.id,
      action: job.action,
      ok: false,
      error: message,
      durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
    });
    await persistRun(job).catch(() => undefined);
  } finally {
    setExecutingJobId(null);
    activeJobId = null;
    clearControl(id);
  }
}

/** Attach a live screenshot (base64) to the active or given job + primary step. */
export async function attachJobFrame(opts: {
  jobId?: string;
  base64: string;
  caption: string;
  mime?: string;
}): Promise<TraceFrameRef | null> {
  const job = opts.jobId ? jobs.get(opts.jobId) : getActiveJob();
  if (!job) return null;
  const frame = await writeFramePng(job, opts.base64, opts.caption);
  const step = job.steps[job.steps.length - 1];
  if (step) {
    step.frames.push({ ...frame, base64: undefined });
    if (!step.glyphs.includes("shot")) {
      step.glyphs = [...step.glyphs, "shot" as Glyph].slice(0, 6);
    }
  }
  // keep base64 in memory frame list for live UI
  publish({
    type: "job.frame",
    at: frame.capturedAt,
    jobId: job.id,
    frame: { ...frame },
  });
  // update run.json opportunistically
  void persistRun(job).catch(() => undefined);
  return frame;
}

export async function runJobSync(input: EnqueueJobInput): Promise<TestJob> {
  const job = enqueueJob(input);
  for (;;) {
    const current = getJob(job.id);
    if (!current) throw new Error("job vanished");
    if (
      current.status === "ok" ||
      current.status === "error" ||
      current.status === "healed" ||
      current.status === "cancelled"
    ) {
      return current;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
