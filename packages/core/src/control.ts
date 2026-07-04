/**
 * Cooperative job control — cancel / pause / resume.
 * Checked from sleep loops and between log lines during execution.
 */

export class JobCancelledError extends Error {
  readonly code = "CANCELLED" as const;
  constructor(message = "Job cancelled") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export type JobControlState = {
  cancel: boolean;
  pause: boolean;
};

const controls = new Map<string, JobControlState>();

export function ensureControl(jobId: string): JobControlState {
  let c = controls.get(jobId);
  if (!c) {
    c = { cancel: false, pause: false };
    controls.set(jobId, c);
  }
  return c;
}

export function clearControl(jobId: string): void {
  controls.delete(jobId);
}

export function requestCancel(jobId: string): void {
  const c = ensureControl(jobId);
  c.cancel = true;
  c.pause = false; // cancel wins over pause
}

export function requestPause(jobId: string): void {
  const c = ensureControl(jobId);
  if (!c.cancel) c.pause = true;
}

export function requestResume(jobId: string): void {
  const c = ensureControl(jobId);
  c.pause = false;
}

export function getControl(jobId: string): JobControlState | undefined {
  return controls.get(jobId);
}

/** Active job id for sleep/wait integration (set by session while executing). */
let executingJobId: string | null = null;

export function setExecutingJobId(id: string | null): void {
  executingJobId = id;
}

export function getExecutingJobId(): string | null {
  return executingJobId;
}

/** Sync cancel check (safe from sync onLog callbacks). */
export function throwIfCancelled(jobId?: string | null): void {
  const id = jobId ?? executingJobId;
  if (!id) return;
  const c = controls.get(id);
  if (c?.cancel) throw new JobCancelledError();
}

/**
 * Yield point: throw if cancelled; wait while paused.
 * Call frequently from sleep and between steps.
 */
export async function cooperativeCheckpoint(jobId?: string | null): Promise<void> {
  const id = jobId ?? executingJobId;
  if (!id) return;
  const c = controls.get(id);
  if (!c) return;

  if (c.cancel) throw new JobCancelledError();

  // Reflect pause in job status is handled by pauseJob(); here we only block.
  while (c.pause && !c.cancel) {
    await new Promise((r) => setTimeout(r, 120));
  }

  if (c.cancel) throw new JobCancelledError();
}
