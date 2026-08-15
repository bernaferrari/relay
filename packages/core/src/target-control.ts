import { AsyncLocalStorage } from "node:async_hooks";
import { KeyedSerialQueue } from "./coordination-store.js";

export class TargetControlReservedError extends Error {
  readonly code = "TARGET_CONTROL_RESERVED" as const;

  constructor(readonly targetId: string) {
    super(`Target ${targetId} is reserved by an active automated run`);
    this.name = "TargetControlReservedError";
  }
}

const mutations = new KeyedSerialQueue();
const reservations = new Map<string, string>();
const heldTargets = new AsyncLocalStorage<ReadonlySet<string>>();

/** Reserve a target for a run. The target scheduler normally prevents two
 * jobs from reaching this point; the guard keeps that invariant explicit. */
export function reserveTargetControl(targetId: string, jobId: string): () => void {
  const current = reservations.get(targetId);
  if (current && current !== jobId) throw new TargetControlReservedError(targetId);
  reservations.set(targetId, jobId);
  return () => {
    if (reservations.get(targetId) === jobId) reservations.delete(targetId);
  };
}

export function targetControlReservation(targetId: string): string | undefined {
  return reservations.get(targetId);
}

/** Serialize mutations per physical target and reject callers outside the run
 * that currently owns the target. Different targets remain fully concurrent. */
export function runTargetMutation<T>(
  targetId: string,
  executingJobId: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  if (heldTargets.getStore()?.has(targetId)) return operation();
  return mutations.run(targetId, async () => {
    const reservedBy = reservations.get(targetId);
    if (reservedBy && reservedBy !== executingJobId) throw new TargetControlReservedError(targetId);
    const held = new Set(heldTargets.getStore() ?? []);
    held.add(targetId);
    return heldTargets.run(held, operation);
  });
}
