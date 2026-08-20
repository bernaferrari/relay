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

export class IosSnapshotInFlightError extends Error {
  constructor() {
    super(
      "iOS accessibility is still reading the previous screen. Wait for it to settle or reconnect the iPad before requesting another full tree.",
    );
    this.name = "IosSnapshotInFlightError";
  }
}

type IosSnapshotFlight = {
  interactiveOnly: boolean;
  timedOut: boolean;
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

function raceIosSnapshotTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("iOS snapshot timed out")),
      IOS_SNAPSHOT_TIMEOUT_MS,
    );
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
): Promise<SnapshotNode[]> {
  const key = iosSnapshotKey(context);
  if (!key) throw new Error("iOS snapshot single-flight requires a connected iOS target");
  const existing = iosSnapshotFlights.get(key);
  if (existing) {
    if (existing.timedOut) throw new IosSnapshotInFlightError();
    // A full tree is a safe superset of an interactive-only tree, so those
    // callers can share work. The inverse is not safe: do not make a full
    // request look complete after an interactive-only SDK response.
    if (!existing.interactiveOnly || interactiveOnly) return await existing.result;
    throw new IosSnapshotInFlightError();
  }

  let flight!: IosSnapshotFlight;
  const native = Promise.resolve().then(run);
  const result = raceIosSnapshotTimeout(native).then(
    (value) => (value.nodes ?? []) as SnapshotNode[],
  );
  flight = { interactiveOnly, timedOut: false, result };
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
