/**
 * Bounded, per-device XCTest accessibility reads.
 *
 * iOS cannot cancel a tree traversal once it has started. This module owns the
 * single-flight guard so device.ts can stay focused on the platform-neutral
 * capability surface rather than accumulating iPad session policy.
 */
import type { SnapshotNode } from "./device.js";
import type { TargetContext } from "./target-context.js";

export const IOS_SNAPSHOT_TIMEOUT_MS = 8_000;

/** A bounded wait expired while XCTest is still traversing the current
 * accessibility tree. This is distinct from a missing XCTest session: the
 * runner may be healthy and the native query remains uncancellable. */
export class IosSnapshotTimedOutError extends Error {
  readonly code = "IOS_SNAPSHOT_ACCESSIBILITY_QUERY_TIMED_OUT";
  readonly inFlight = true;

  constructor(
    readonly timeoutMs: number,
    readonly elapsedMs: number,
  ) {
    super(
      `iOS accessibility is still reading this screen after ${elapsedMs}ms. Pixels remain usable; wait for the current query to settle before refreshing names.`,
    );
    this.name = "IosSnapshotTimedOutError";
  }
}

export class IosSnapshotInFlightError extends Error {
  readonly code = "IOS_SNAPSHOT_ACCESSIBILITY_QUERY_IN_FLIGHT";
  readonly inFlight = true;

  constructor(readonly elapsedMs?: number) {
    super(
      `iOS accessibility is still reading this screen${elapsedMs !== undefined ? ` (${elapsedMs}ms so far)` : ""}. Pixels remain usable; wait for the current query to settle before refreshing names.`,
    );
    this.name = "IosSnapshotInFlightError";
  }
}

/** A tree read is running or exceeded Relay's wait budget, but XCTest itself
 * has not been proven unavailable. Callers must not reconnect or start a
 * second tree traversal in response. */
export function isIosAccessibilityQueryInFlightError(
  error: unknown,
): error is IosSnapshotTimedOutError | IosSnapshotInFlightError {
  return error instanceof IosSnapshotTimedOutError || error instanceof IosSnapshotInFlightError;
}

type IosSnapshotFlight = {
  interactiveOnly: boolean;
  timedOut: boolean;
  startedAt: number;
  result: Promise<SnapshotNode[]>;
};

const iosSnapshotFlights = new Map<string, IosSnapshotFlight>();

function iosSnapshotKey(context: TargetContext): string | undefined {
  return context.kind === "device" && context.platform === "ios"
    ? `${context.platform}:${context.serial}`
    : undefined;
}

export function resetIosSnapshotFlights(context?: TargetContext): void {
  const key = context ? iosSnapshotKey(context) : undefined;
  if (key) iosSnapshotFlights.delete(key);
  else if (!context) iosSnapshotFlights.clear();
}

function boundedIosSnapshotTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return IOS_SNAPSHOT_TIMEOUT_MS;
  // A caller can tighten the wait for a preview, but cannot turn this bounded
  // fallback into an unbounded XCTest wait.
  return Math.max(1, Math.min(IOS_SNAPSHOT_TIMEOUT_MS, Math.round(timeoutMs)));
}

function raceIosSnapshotTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      const elapsedMs = Math.max(timeoutMs, Date.now() - startedAt);
      reject(new IosSnapshotTimedOutError(timeoutMs, elapsedMs));
    }, timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/**
 * Share compatible iOS tree reads, but retain the lock until XCTest itself
 * settles. A timeout only stops Relay from waiting; it never means the runner
 * is ready for another command.
 */
export async function snapshotIosSingleFlight(
  context: TargetContext,
  interactiveOnly: boolean,
  run: () => Promise<{ nodes?: SnapshotNode[] }>,
  timeoutMs?: number,
): Promise<SnapshotNode[]> {
  const key = iosSnapshotKey(context);
  if (!key) throw new Error("iOS snapshot single-flight requires a connected iOS target");
  const existing = iosSnapshotFlights.get(key);
  if (existing) {
    const elapsedMs = Math.max(0, Date.now() - existing.startedAt);
    if (existing.timedOut) throw new IosSnapshotInFlightError(elapsedMs);
    // A full tree is a safe superset of an interactive-only tree, so those
    // callers can share work. The inverse is not safe: do not make a full
    // request look complete after an interactive-only SDK response.
    if (!existing.interactiveOnly || interactiveOnly) return await existing.result;
    throw new IosSnapshotInFlightError(elapsedMs);
  }

  let flight!: IosSnapshotFlight;
  const startedAt = Date.now();
  const native = Promise.resolve().then(run);
  const result = raceIosSnapshotTimeout(native, boundedIosSnapshotTimeoutMs(timeoutMs)).then(
    (value) => (value.nodes ?? []) as SnapshotNode[],
  );
  flight = { interactiveOnly, timedOut: false, startedAt, result };
  iosSnapshotFlights.set(key, flight);

  // Retain the lock until the actual native request settles, not merely until
  // the bounded caller result rejects. That is what prevents a timed-out
  // request from being followed by a second overlapping XCTest traversal.
  void native
    .finally(() => {
      if (iosSnapshotFlights.get(key) === flight) iosSnapshotFlights.delete(key);
    })
    .catch(() => undefined);
  void result.catch(() => {
    flight.timedOut = true;
  });

  return await result;
}

/** Normalize only a genuine runner/session absence. A bounded traversal
 * timeout remains typed in-flight so callers can keep pixels useful without
 * falsely prompting for repair. */
export async function captureIosSnapshot(
  context: TargetContext,
  interactiveOnly: boolean,
  run: () => Promise<{ nodes?: SnapshotNode[] }>,
  timeoutMs?: number,
): Promise<SnapshotNode[]> {
  try {
    return await snapshotIosSingleFlight(context, interactiveOnly, run, timeoutMs);
  } catch (error) {
    if (isIosAccessibilityQueryInFlightError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/session|open first/i.test(message)) {
      throw new Error("iOS snapshot needs an active XCTest session");
    }
    throw error;
  }
}
