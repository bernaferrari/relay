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
const occupancy = new Map<string, Set<string>>();
const reservations = new Map<string, string>();
const heldTargets = new AsyncLocalStorage<ReadonlySet<string>>();

function holdersOf(targetId: string): Set<string> {
  let holders = occupancy.get(targetId);
  if (!holders) {
    holders = new Set();
    occupancy.set(targetId, holders);
  }
  return holders;
}

/** Mark a target occupied by a queued or running job. Several jobs may wait on
 * the same serial; interactive input is rejected until the last one releases. */
export function reserveTargetControl(targetId: string, jobId: string): () => void {
  holdersOf(targetId).add(jobId);
  reservations.set(targetId, jobId);
  return () => releaseTargetControl(targetId, jobId);
}

export function releaseTargetControl(targetId: string, jobId: string): void {
  const holders = occupancy.get(targetId);
  holders?.delete(jobId);
  if (!holders || holders.size === 0) {
    occupancy.delete(targetId);
    reservations.delete(targetId);
    return;
  }
  const next = holders.values().next().value;
  if (next) reservations.set(targetId, next);
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
    const holders = occupancy.get(targetId);
    if (holders && holders.size > 0 && (!executingJobId || !holders.has(executingJobId))) {
      throw new TargetControlReservedError(targetId);
    }
    const held = new Set(heldTargets.getStore() ?? []);
    held.add(targetId);
    return heldTargets.run(held, operation);
  });
}
