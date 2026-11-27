/**
 * Retry transient device/UI failures while honoring cancel/pause.
 */
import { cooperativeCheckpoint, JobCancelledError } from "./control.js";

const TRANSIENT =
  /timeout|timed out|not found|no match|stale|offline|connection reset|ECONNRESET|socket|temporarily|try again|failed to|unable to|unknown error|device .* (offline|not found)/i;

export function isTransientError(err: unknown): boolean {
  if (err instanceof JobCancelledError) return false;
  if (err instanceof Error && err.name === "JobCancelledError") return false;
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT.test(msg);
}

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  label?: string;
  onRetry?: (attempt: number, err: unknown) => void;
};

/**
 * Retry `fn` on transient errors. Cancel always aborts immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 350;
  let last: unknown;

  for (let i = 1; i <= attempts; i++) {
    await cooperativeCheckpoint();
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (
        err instanceof JobCancelledError ||
        (err instanceof Error && err.name === "JobCancelledError")
      ) {
        throw err;
      }
      if (i >= attempts || !isTransientError(err)) throw err;
      opts.onRetry?.(i, err);
      // exponential-ish backoff with cancel/pause awareness
      const delay = baseDelayMs * i;
      const end = Date.now() + delay;
      while (Date.now() < end) {
        await cooperativeCheckpoint();
        await new Promise((r) => setTimeout(r, Math.min(80, end - Date.now())));
      }
    }
  }
  throw last;
}
