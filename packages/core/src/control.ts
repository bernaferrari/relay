import { AsyncLocalStorage } from "node:async_hooks";
import { targetSessionName, type TargetContext } from "./target-context.js";

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

export class JobControlOwnershipError extends Error {
  readonly code = "CONTROL_OWNERSHIP_LOST" as const;
  constructor(message = "Job control lease is no longer valid") {
    super(message);
    this.name = "JobControlOwnershipError";
  }
}

export type JobControlState = {
  cancel: boolean;
  pause: boolean;
  /** Incremented on cancel for waiters */
  generation: number;
  /** Execution ownership check installed by the job host. */
  validator?: JobControlValidator;
};

export type JobControlValidator = () => Promise<void>;

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

/** White-box: number of live cancel-waiters for a job (0 after cleanup). */
export function debugWaiterCount(jobId: string): number {
  return cancelWaiters.get(jobId)?.size ?? 0;
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

export function setControlValidator(jobId: string, validator: JobControlValidator): void {
  ensureControl(jobId).validator = validator;
}

let fallbackExecutingJobId: string | null = null;
const executingJobs = new AsyncLocalStorage<string>();

export function setExecutingJobId(id: string | null): void {
  fallbackExecutingJobId = id;
}

export function getExecutingJobId(): string | null {
  return executingJobs.getStore() ?? fallbackExecutingJobId;
}

export function runWithJobControl<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
  return executingJobs.run(jobId, operation);
}

export function throwIfCancelled(jobId?: string | null): void {
  const id = jobId ?? getExecutingJobId();
  if (!id) return;
  if (controls.get(id)?.cancel) throw new JobCancelledError();
}

/**
 * Race a promise against cancel. On cancel, rejects with JobCancelledError
 * even if the underlying work is still running (caller may hard-stop session).
 *
 * All resources this allocates (the poll interval and the cancel-waiter entry)
 * are released in `finally`, regardless of whether the op or the cancel signal
 * wins the race — so a normal completion no longer leaks a 40 ms timer.
 */
export async function raceCancel<T>(promise: Promise<T>, jobId?: string | null): Promise<T> {
  const id = jobId ?? getExecutingJobId();
  if (!id) return promise;
  throwIfCancelled(id);

  let cleanup = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    const check = () => {
      if (controls.get(id)?.cancel) reject(new JobCancelledError());
    };
    let set = cancelWaiters.get(id);
    if (!set) {
      set = new Set();
      cancelWaiters.set(id, set);
    }
    set.add(check);
    const poll = setInterval(check, 40);
    cleanup = () => {
      clearInterval(poll);
      set.delete(check);
    };
    check();
  });

  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    cleanup();
  }
}

export async function cooperativeCheckpoint(jobId?: string | null): Promise<void> {
  const id = jobId ?? getExecutingJobId();
  if (!id) return;
  const c = controls.get(id);
  if (!c) return;

  if (c.cancel) throw new JobCancelledError();
  await c.validator?.();
  if (c.cancel) throw new JobCancelledError();

  while (c.pause && !c.cancel) {
    await new Promise((r) => setTimeout(r, 50));
    await c.validator?.();
  }

  if (c.cancel) throw new JobCancelledError();
}

/**
 * Wait for a cooperative resume, optionally failing when a human checkpoint
 * has been left unattended for too long. The timer is always cleared so a
 * completed checkpoint cannot keep the process alive.
 */
export async function cooperativeCheckpointWithTimeout(
  jobId: string,
  timeoutMs?: number,
): Promise<void> {
  if (!timeoutMs) {
    await cooperativeCheckpoint(jobId);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cooperativeCheckpoint(jobId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`human checkpoint timed out after ${Math.round(timeoutMs / 1000)}s`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Best-effort: close agent-device session so in-flight commands drop. */
export async function hardStopDeviceSession(
  target: TargetContext,
  options?: { alsoCloseSessions?: string[] },
): Promise<void> {
  try {
    const { createAgentDeviceClient } = await import("agent-device");
    const names = [
      process.env.AGENT_DEVICE_SESSION?.trim() || targetSessionName(target),
      ...(options?.alsoCloseSessions ?? []),
    ].filter((name, index, all): name is string => Boolean(name) && all.indexOf(name) === index);

    for (const session of names) {
      try {
        const client = createAgentDeviceClient({ session });
        // shutdown:true tears down the on-device XCTest process. Without that, a
        // watchdog-wedged runner keeps failing every command until the iPad reboots.
        await client.sessions.close({ shutdown: true }).catch(async () => {
          await client.sessions.close({ shutdown: false });
        });
      } catch {
        /* session may already be gone */
      }
    }
  } catch {
    /* session may already be gone */
  }
}
