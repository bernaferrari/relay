/**
 * Fail-closed server shutdown sequencing.
 *
 * The HTTP listener is only one producer of device work: an already-running
 * schedule tick and the process-local session scheduler may outlive it. Keep
 * the state-directory lease until all three have reached a terminal boundary.
 */
export const DEFAULT_SERVER_SHUTDOWN_TIMEOUT_MS = 15_000;

export class ServerShutdownTimeoutError extends Error {
  readonly code = "SERVER_SHUTDOWN_TIMEOUT" as const;

  constructor(readonly phase: "http" | "handlers" | "scheduler" | "session" | "activity") {
    super(`Relay server shutdown timed out while waiting for ${phase}`);
    this.name = "ServerShutdownTimeoutError";
  }
}

export type ServerShutdownDependencies = {
  stopRequestAdmission(): void;
  closeHttp(): Promise<void>;
  drainRequestHandlers(): Promise<void>;
  closeScheduler(): Promise<void>;
  closeSse(): void;
  drainSessionExecutions(timeoutMs: number): Promise<void>;
  flushActivity(): Promise<void>;
  releaseStateLease(): void;
  timeoutMs?: number;
};

function timeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return DEFAULT_SERVER_SHUTDOWN_TIMEOUT_MS;
  }
  return Math.floor(value);
}

async function withinDeadline<T>(
  operation: Promise<T>,
  phase: ServerShutdownTimeoutError["phase"],
  limitMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ServerShutdownTimeoutError(phase)), limitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Return an idempotent close operation. A timeout or error intentionally keeps
 * the state-directory lease in place; callers can retry after the lingering
 * work settles, while a fresh Relay server remains unable to recover it.
 */
export function createFailClosedServerShutdown(
  dependencies: ServerShutdownDependencies,
): () => Promise<void> {
  const limitMs = timeoutMs(dependencies.timeoutMs);
  let sseClosed = false;
  let admissionClosed = false;
  let httpClose: Promise<void> | undefined;
  let schedulerClose: Promise<void> | undefined;
  let released = false;
  let inFlight: Promise<void> | undefined;

  return async () => {
    if (released) return;
    if (inFlight) return await inFlight;
    if (!admissionClosed) {
      dependencies.stopRequestAdmission();
      admissionClosed = true;
    }
    if (!sseClosed) {
      dependencies.closeSse();
      sseClosed = true;
    }
    httpClose ??= dependencies.closeHttp();
    schedulerClose ??= dependencies.closeScheduler();
    inFlight = (async () => {
      // Preserve an HTTP close error rather than obscuring it with a later
      // scheduler/drain failure; in either case the lease remains held.
      await withinDeadline(httpClose!, "http", limitMs);
      await withinDeadline(dependencies.drainRequestHandlers(), "handlers", limitMs);
      await withinDeadline(schedulerClose!, "scheduler", limitMs);
      await withinDeadline(dependencies.drainSessionExecutions(limitMs), "session", limitMs);
      await withinDeadline(dependencies.flushActivity(), "activity", limitMs);
      dependencies.releaseStateLease();
      released = true;
    })();
    try {
      await inFlight;
    } finally {
      if (!released) inFlight = undefined;
    }
  };
}
