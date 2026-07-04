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

export type JobStatus = "queued" | "running" | "ok" | "error" | "healed";

export type TestJob = {
  id: string;
  action: ActionId;
  serial?: string;
  status: JobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  result?: unknown;
  error?: string;
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
      await executeJob(id);
    }
  } finally {
    draining = false;
  }
}

async function executeJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;

  activeJobId = id;
  job.status = "running";
  job.startedAt = now();
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
  // seed planned micro-steps as a single running recipe step (collapses to one primary)
  const primary = openStep(job, {
    kind: job.retryOf ? "Healed" : plan.kind,
    tone: job.retryOf ? "heal" : plan.tone,
    title: job.title,
    glyphs: job.retryOf ? (["re", ...plan.glyphs] as Glyph[]) : plan.glyphs,
    status: "running",
    log: job.retryOf
      ? `retry of ${job.retryOf.slice(0, 8)} · attempt ${job.attempts}`
      : `start ${job.action}`,
  });

  // optional planned sub-notes in log
  for (const p of plan.planned) {
    appendStepLog(primary, `· plan: ${p.title} [${p.glyphs.join(",")}]`);
  }

  const pushLog = (line: string) => {
    job.logs.push(line);
    appendStepLog(primary, line);
    const level = /FAIL|error|Error/i.test(line)
      ? ("error" as const)
      : /DONE|success/i.test(line)
        ? ("success" as const)
        : ("info" as const);
    publish({ type: "job.log", at: now(), jobId: job.id, line, level });
  };

  try {
    const device = createDevice();
    const opts: RunActionOptions = {
      skipAccountSwitch: job.options?.skipAccountSwitch,
      skipRestoreHome: job.options?.skipRestoreHome,
      onLog: pushLog,
    };
    const result: RunActionResult = await runAction(device, job.action, opts);
    job.finishedAt = now();

    if (result.ok) {
      const wasRetry = Boolean(job.retryOf && job.previousError);
      if (wasRetry) {
        job.status = "healed";
        job.healed = true;
        job.healMessage = `Recovered after failure: ${job.previousError}. Recipe re-ran successfully on attempt ${job.attempts}.`;
        job.tone = "heal";
        job.kind = "Healed";
        primary.tone = "heal";
        primary.kind = "Healed";
        primary.heal = job.healMessage;
        finishStep(primary, "healed", `✓ healed · ${result.result ?? "ok"}`);
        publish({
          type: "job.healed",
          at: job.finishedAt,
          jobId: job.id,
          action: job.action,
          healMessage: job.healMessage,
        });
      } else {
        job.status = "ok";
        finishStep(primary, "ok", `✓ ${result.result ?? "ok"}`);
      }
      job.result = result.result;
      job.error = undefined;
    } else {
      job.status = "error";
      job.error = result.error;
      finishStep(primary, "error", `✗ ${result.error}`);
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
    const message = err instanceof Error ? err.message : String(err);
    job.finishedAt = now();
    job.status = "error";
    job.error = message;
    finishStep(primary, "error", `✗ ${message}`);
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
    activeJobId = null;
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
    if (current.status === "ok" || current.status === "error" || current.status === "healed") {
      return current;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
