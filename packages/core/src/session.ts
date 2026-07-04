/**
 * Test-run sessions (OpenCode sessions, but for app-testing jobs).
 */
import { randomUUID } from "node:crypto";
import { now, publish } from "./events.js";
import {
  isActionId,
  runAction,
  type ActionId,
  type RunActionOptions,
  type RunActionResult,
} from "./actions.js";
import { createDevice } from "./device.js";

export type JobStatus = "queued" | "running" | "ok" | "error";

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
};

export function enqueueJob(input: EnqueueJobInput): TestJob {
  if (!isActionId(input.action)) {
    throw new Error(`Unknown action: ${input.action}`);
  }
  const job: TestJob = {
    id: randomUUID(),
    action: input.action,
    serial: input.serial?.trim() || undefined,
    status: "queued",
    queuedAt: now(),
    logs: [],
    options: {
      skipAccountSwitch: input.skipAccountSwitch,
      skipRestoreHome: input.skipRestoreHome,
      prodAccountMatch: input.prodAccountMatch,
    },
  };
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

  const pushLog = (line: string) => {
    job.logs.push(line);
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
    job.status = result.ok ? "ok" : "error";
    job.result = result.ok ? result.result : undefined;
    job.error = result.ok ? undefined : result.error;
    publish({
      type: "job.finished",
      at: job.finishedAt,
      jobId: job.id,
      action: job.action,
      ok: result.ok,
      result: job.result,
      error: job.error,
      durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.finishedAt = now();
    job.status = "error";
    job.error = message;
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
  } finally {
    activeJobId = null;
  }
}

/** Run synchronously (CLI direct mode) — still records a job. */
export async function runJobSync(input: EnqueueJobInput): Promise<TestJob> {
  const job = enqueueJob(input);
  // wait until finished
  for (;;) {
    const current = getJob(job.id);
    if (!current) throw new Error("job vanished");
    if (current.status === "ok" || current.status === "error") return current;
    await new Promise((r) => setTimeout(r, 50));
  }
}
