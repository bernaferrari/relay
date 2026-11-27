/**
 * Unsigned browser overlap admission.
 *
 * Unsigned browser proof runs share no Playwright state: each Run owns a
 * fresh ephemeral context. The only shared surface left is the application
 * backend behind one managed target, and the declared-effects model is the
 * only honest signal about it. Tests without restrictive declarations are
 * independent readers of that surface and may overlap; tests whose effects
 * fail closed (or legacy work that never classified) must not overlap any
 * other unsigned run on the same target.
 *
 * A lane assignment cannot express that reader/writer shape: the set of
 * independent runs is unbounded and dynamic, so mutual exclusion has to be
 * admission-time state rather than a scheduler identity. This module is a
 * small FIFO-fair reader/writer gate per managed browser target:
 *
 * - `shared` holders overlap each other (independent tests).
 * - `exclusive` holders overlap nothing (fail-closed tests, unclassified
 *   legacy enqueue paths, batched Combine/scheduler cells).
 *
 * Fairness is strict FIFO: once an exclusive waiter reaches the head of the
 * queue, later shared waiters queue behind it, so a stream of independent
 * runs cannot starve a queued exclusive run forever. Gate waiters always
 * already hold their scheduler lane and host slot, and no job ever waits on
 * a scheduler lane while holding the gate, so the acquisition order cannot
 * deadlock.
 */
import { raceCancel } from "../execution/control.js";

export type UnsignedBrowserOverlapMode = "shared" | "exclusive";

export type UnsignedBrowserOverlapSnapshot = {
  readers: number;
  writerActive: boolean;
  queued: number;
  queuedExclusive: number;
};

type Waiter = {
  mode: UnsignedBrowserOverlapMode;
  granted: boolean;
  released: boolean;
  grant: (release: () => void) => void;
};

type TargetGate = {
  readers: number;
  writerActive: boolean;
  queue: Waiter[];
};

const gates = new Map<string, TargetGate>();

function gateFor(targetId: string): TargetGate {
  let gate = gates.get(targetId);
  if (!gate) {
    gate = { readers: 0, writerActive: false, queue: [] };
    gates.set(targetId, gate);
  }
  return gate;
}

function sweep(targetId: string, gate: TargetGate): void {
  if (gate.readers === 0 && !gate.writerActive && gate.queue.length === 0) {
    gates.delete(targetId);
  }
}

function drainGate(targetId: string, gate: TargetGate): void {
  while (gate.queue.length) {
    const next = gate.queue[0]!;
    if (next.mode === "exclusive") {
      if (gate.writerActive || gate.readers > 0) return;
      gate.queue.shift();
      gate.writerActive = true;
      next.granted = true;
      next.grant(makeRelease(targetId, gate, next));
      return;
    }
    if (gate.writerActive) return;
    gate.queue.shift();
    gate.readers += 1;
    next.granted = true;
    next.grant(makeRelease(targetId, gate, next));
  }
}

function makeRelease(targetId: string, gate: TargetGate, waiter: Waiter): () => void {
  return () => {
    if (waiter.released) return;
    waiter.released = true;
    if (waiter.mode === "exclusive") gate.writerActive = false;
    else gate.readers = Math.max(0, gate.readers - 1);
    drainGate(targetId, gate);
    sweep(targetId, gate);
  };
}

/**
 * Acquire one overlap slot for one unsigned browser run. Cancelling the job
 * while it waits removes the waiter without consuming a grant; a grant that
 * raced the cancellation is released immediately so neither readers nor the
 * writer flag can leak.
 */
export async function acquireUnsignedBrowserOverlap(input: {
  targetId: string;
  mode: UnsignedBrowserOverlapMode;
  jobId?: string;
}): Promise<() => void> {
  const targetId = input.targetId.trim();
  if (!targetId) throw new Error("Unsigned browser overlap requires an explicit target");
  const gate = gateFor(targetId);
  let waiter: Waiter | undefined;
  let grantedRelease: (() => void) | undefined;
  const granted = new Promise<() => void>((resolve) => {
    waiter = {
      mode: input.mode,
      granted: false,
      released: false,
      grant: (release) => {
        grantedRelease = release;
        resolve(release);
      },
    };
    gate.queue.push(waiter);
    drainGate(targetId, gate);
  });
  try {
    return await raceCancel(granted, input.jobId);
  } catch (error) {
    if (waiter && !waiter.granted) {
      const index = gate.queue.indexOf(waiter);
      if (index >= 0) gate.queue.splice(index, 1);
      drainGate(targetId, gate);
      sweep(targetId, gate);
    } else {
      // The grant won the race but the operation will never run: overlapping
      // work must not observe a phantom reader or a stuck writer flag.
      grantedRelease?.();
    }
    throw error;
  }
}

/** Hold one overlap slot for the duration of one operation. */
export async function runWithUnsignedBrowserOverlap<T>(
  input: {
    targetId: string;
    mode: UnsignedBrowserOverlapMode;
    jobId?: string;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireUnsignedBrowserOverlap(input);
  try {
    return await operation();
  } finally {
    release();
  }
}

/** Derive the overlap admission one browser proof job must hold while it
 * owns its ephemeral context. Fixture accounts and invoked Lanes already
 * carry their own serialization and never enter the unsigned gate; every
 * other unsigned browser run participates — independent classified runs as
 * readers, everything else as the exclusive writer it already was when the
 * shared lane serialized it. */
export function unsignedBrowserOverlapAdmissionForJob(job: {
  targetKind?: string;
  browserTargetId?: string;
  browserCaseProfile?: { authenticationFixtureId?: string };
  laneId?: string;
  browserIsolation?: "independent";
}): { targetId: string; mode: UnsignedBrowserOverlapMode } | undefined {
  if (job.targetKind !== "browser") return undefined;
  const targetId = job.browserTargetId?.trim();
  if (!targetId) return undefined;
  if (job.browserCaseProfile?.authenticationFixtureId?.trim()) return undefined;
  if (job.laneId?.trim()) return undefined;
  return {
    targetId,
    mode: job.browserIsolation === "independent" ? "shared" : "exclusive",
  };
}

export function unsignedBrowserOverlapSnapshot(targetId: string): UnsignedBrowserOverlapSnapshot {
  const gate = gates.get(targetId);
  return {
    readers: gate?.readers ?? 0,
    writerActive: gate?.writerActive ?? false,
    queued: gate?.queue.length ?? 0,
    queuedExclusive: gate?.queue.filter((waiter) => waiter.mode === "exclusive").length ?? 0,
  };
}

/** Test-only reset so one temporary state root cannot leak gate state into another. */
export function resetUnsignedBrowserOverlapForTests(): void {
  gates.clear();
}
