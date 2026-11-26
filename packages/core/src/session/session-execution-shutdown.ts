/**
 * Bounded shutdown for the process-local session scheduler.
 *
 * The HTTP server owns the state-directory lease, while the session scheduler
 * owns physical input. Releasing the former before the latter has drained
 * would let a new server reinterpret a still-live assignment. This helper
 * deliberately leaves a caller with an error rather than claiming that an
 * uncooperative device operation is safe to hand over.
 */
import type { TestJob } from "./session-contract.js";

export const DEFAULT_SESSION_EXECUTION_SHUTDOWN_TIMEOUT_MS = 15_000;

export class SessionExecutionShutdownError extends Error {
  readonly code:
    | "SESSION_EXECUTION_SHUTDOWN_TIMEOUT"
    | "SESSION_EXECUTION_SHUTDOWN_CANCEL_FAILED"
    | "SESSION_EXECUTION_SHUTDOWN_COMPLETION_FAILED";

  constructor(
    code: SessionExecutionShutdownError["code"],
    readonly jobIds: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = "SessionExecutionShutdownError";
    this.code = code;
  }
}

export type SessionExecutionShutdownDependencies = {
  activeJobs(): readonly TestJob[];
  cancelJob(id: string): TestJob;
  waitForCompletion(id: string): Promise<TestJob>;
};

export type SessionExecutionShutdownOptions = {
  timeoutMs?: number;
};

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return DEFAULT_SESSION_EXECUTION_SHUTDOWN_TIMEOUT_MS;
  }
  return Math.floor(value);
}

/**
 * Request cancellation for every active job, then wait for the same lifecycle
 * completion boundary used by synchronous callers. A timeout does not erase
 * the durable assignment: the caller must keep its state-dir lease and either
 * retry shutdown or let process death trigger normal restart recovery.
 */
export async function shutdownSessionExecutions(
  dependencies: SessionExecutionShutdownDependencies,
  options: SessionExecutionShutdownOptions = {},
): Promise<void> {
  const jobs = [...new Map(dependencies.activeJobs().map((job) => [job.id, job])).values()];
  if (!jobs.length) return;
  const jobIds = jobs.map((job) => job.id);
  const cancellationFailures: string[] = [];
  const completions: Promise<TestJob>[] = [];

  for (const job of jobs) {
    try {
      dependencies.cancelJob(job.id);
      completions.push(dependencies.waitForCompletion(job.id));
    } catch {
      cancellationFailures.push(job.id);
    }
  }
  if (cancellationFailures.length) {
    throw new SessionExecutionShutdownError(
      "SESSION_EXECUTION_SHUTDOWN_CANCEL_FAILED",
      cancellationFailures,
      `Relay could not request cancellation for ${cancellationFailures.length} active session job(s)`,
    );
  }

  const timeoutMs = boundedTimeout(options.timeoutMs);
  const drained = Promise.allSettled(completions);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      drained,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new SessionExecutionShutdownError(
              "SESSION_EXECUTION_SHUTDOWN_TIMEOUT",
              dependencies.activeJobs().map((job) => job.id),
              `Timed out waiting for active Relay session jobs to stop after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const failed = (await drained)
    .map((result, index) => (result.status === "rejected" ? jobIds[index] : undefined))
    .filter((id): id is string => Boolean(id));
  const remaining = dependencies.activeJobs().map((job) => job.id);
  if (failed.length || remaining.length) {
    throw new SessionExecutionShutdownError(
      "SESSION_EXECUTION_SHUTDOWN_COMPLETION_FAILED",
      [...new Set([...failed, ...remaining])],
      "Relay session shutdown completed without a durable terminal boundary for every active job",
    );
  }
}
