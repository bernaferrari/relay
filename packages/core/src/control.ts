/**
 * Job control — cooperative pause + aggressive cancel.
 *
 * - Cancel: flags cancel, optional hard stop of agent-device session
 * - Pause: blocks at checkpoints / chunked sleeps until resume
 * - raceCancel: aborts waiting as soon as cancel is set (device call may still finish in background)
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
  /** Incremented on cancel for waiters */
  generation: number;
};

const controls = new Map<string, JobControlState>();
const cancelWaiters = new Map<string, Set<() => void>>();

export function ensureControl(jobId: string): JobControlState {
  let c = controls.get(jobId);
  if (!c) {
    c = { cancel: false, pause: false, generation: 0 };
    controls.set(jobId, c);
  }
  return c;
}

export function clearControl(jobId: string): void {
  controls.delete(jobId);
  const waiters = cancelWaiters.get(jobId);
  if (waiters) {
    for (const w of waiters) w();
    cancelWaiters.delete(jobId);
  }
}

function wakeCancelWaiters(jobId: string): void {
  const waiters = cancelWaiters.get(jobId);
  if (!waiters) return;
  for (const w of waiters) w();
  waiters.clear();
}

export function requestCancel(jobId: string): void {
  const c = ensureControl(jobId);
  c.cancel = true;
  c.pause = false;
  c.generation += 1;
  wakeCancelWaiters(jobId);
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

let executingJobId: string | null = null;

export function setExecutingJobId(id: string | null): void {
  executingJobId = id;
}

export function getExecutingJobId(): string | null {
  return executingJobId;
}

export function throwIfCancelled(jobId?: string | null): void {
  const id = jobId ?? executingJobId;
  if (!id) return;
  if (controls.get(id)?.cancel) throw new JobCancelledError();
}

/** Rejects with JobCancelledError once cancel is requested. */
export function waitUntilCancelled(jobId?: string | null): Promise<never> {
  const id = jobId ?? executingJobId;
  if (!id) return new Promise(() => undefined);

  return new Promise((_resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      if (!controls.get(id)?.cancel) return;
      settled = true;
      clearInterval(poll);
      set?.delete(onWake);
      reject(new JobCancelledError());
    };

    if (controls.get(id)?.cancel) {
      reject(new JobCancelledError());
      return;
    }

    const onWake = () => finish();
    let set = cancelWaiters.get(id);
    if (!set) {
      set = new Set();
      cancelWaiters.set(id, set);
    }
    set.add(onWake);

    const poll = setInterval(finish, 40);
  });
}

/**
 * Race a promise against cancel. On cancel, rejects with JobCancelledError
 * even if the underlying work is still running (caller may hard-stop session).
 */
export async function raceCancel<T>(promise: Promise<T>, jobId?: string | null): Promise<T> {
  const id = jobId ?? executingJobId;
  if (!id) return promise;
  throwIfCancelled(id);
  return Promise.race([promise, waitUntilCancelled(id)]);
}

export async function cooperativeCheckpoint(jobId?: string | null): Promise<void> {
  const id = jobId ?? executingJobId;
  if (!id) return;
  const c = controls.get(id);
  if (!c) return;

  if (c.cancel) throw new JobCancelledError();

  while (c.pause && !c.cancel) {
    await new Promise((r) => setTimeout(r, 50));
  }

  if (c.cancel) throw new JobCancelledError();
}

/** Best-effort: close agent-device session so in-flight commands drop. */
export async function hardStopDeviceSession(): Promise<void> {
  try {
    const { createAgentDeviceClient } = await import("agent-device");
    const client = createAgentDeviceClient({
      session: process.env.AGENT_DEVICE_SESSION?.trim() || "grok-actions",
    });
    await client.sessions.close({ shutdown: false });
  } catch {
    /* session may already be gone */
  }
}
