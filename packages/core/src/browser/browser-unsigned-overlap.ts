/**
 * Browser overlap admission for unsigned and runtime-signed-in proof runs.
 *
 * Browser proof runs share no Playwright state: each Run owns a fresh
 * ephemeral context. The shared surfaces left are the application backend
 * behind one managed target and, for a run that executes a saved sign-in, the
 * server-side account it signs into. The declared-effects model is the only
 * honest signal about the backend; the frozen recipe graph is the only honest
 * scheduling-time signal about saved sign-in use.
 *
 * A lane assignment cannot express this reader/writer/account shape: the set
 * of independent runs is unbounded and dynamic, and one run may mention more
 * than one account. Mutual exclusion therefore has to be admission-time state
 * rather than only a scheduler identity. This module is a small FIFO-fair
 * gate per managed browser target:
 *
 * - `shared` holders overlap each other (independent unsigned tests).
 * - `account` holders overlap other account holders whose account sets are
 *   disjoint. A safe-shared-read account may also overlap unsigned readers;
 *   an isolated account may not, because an unsigned/unknown placement is not
 *   proof of a distinct server-side account.
 * - `exclusive` holders overlap nothing (fail-closed tests, ambient or
 *   unknown sign-in identity, unclassified legacy enqueue paths, batched
 *   Combine/scheduler cells).
 *
 * Fairness is strict FIFO: once a waiter reaches the head of the queue,
 * later waiters queue behind it even when they could overlap the currently
 * active holders. That trades a little admission parallelism for a simple
 * no-starvation proof: no later incompatible or compatible waiter can jump
 * ahead of the head, and active holders are finite-duration runs. Gate
 * waiters always already hold their scheduler lane and host slot, and no job
 * ever waits on a scheduler lane while holding the gate, so the acquisition
 * order cannot deadlock. The scheduler additionally gives one runtime sign-in
 * account set one target lane, so ordinary same-account work usually serializes
 * before it consumes a host slot; this gate remains the authoritative atomic
 * multi-account/exclusive boundary.
 */
import { raceCancel } from "../execution/control.js";
import { savedSignInKeysForRecipeGraph } from "../sign-in/sign-in-admission.js";
import type { Recipe } from "../recipe/recipes.js";

export type UnsignedBrowserOverlapMode = "shared" | "exclusive" | "account";

/** Runtime-sharing declaration admitted for per-account overlap. */
export type BrowserAccountOverlapSharing =
  | "safe-shared-read"
  | "isolated-account"
  | "isolated-lane";

export type UnsignedBrowserOverlapSnapshot = {
  readers: number;
  writerActive: boolean;
  queued: number;
  queuedExclusive: number;
};

type Waiter = {
  mode: UnsignedBrowserOverlapMode;
  accountKeys: readonly string[];
  accountSharing?: BrowserAccountOverlapSharing;
  granted: boolean;
  released: boolean;
  grant: (release: () => void) => void;
};

type TargetGate = {
  active: Set<Waiter>;
  queue: Waiter[];
};

const gates = new Map<string, TargetGate>();

function gateFor(targetId: string): TargetGate {
  let gate = gates.get(targetId);
  if (!gate) {
    gate = { active: new Set(), queue: [] };
    gates.set(targetId, gate);
  }
  return gate;
}

function sweep(targetId: string, gate: TargetGate): void {
  if (gate.active.size === 0 && gate.queue.length === 0) {
    gates.delete(targetId);
  }
}

function accountSetsDisjoint(left: readonly string[], right: readonly string[]): boolean {
  const keys = new Set(left);
  return right.every((key) => !keys.has(key));
}

/** Pairwise compatibility for active holders. Account-safe work may meet the
 * unsigned reader group; isolated-account work may meet only a provably
 * disjoint account group. Same-account intersection always fails closed,
 * even when the declared test effects are read-only, because concurrent
 * product sessions are not safe browser-state isolation. */
function holdersCompatible(left: Waiter, right: Waiter): boolean {
  if (left.mode === "exclusive" || right.mode === "exclusive") return false;
  if (left.mode === "shared" || right.mode === "shared") {
    const other = left.mode === "shared" ? right : left;
    if (other.mode === "shared") return true;
    return other.accountSharing === "safe-shared-read";
  }
  return accountSetsDisjoint(left.accountKeys, right.accountKeys);
}

function drainGate(targetId: string, gate: TargetGate): void {
  while (gate.queue.length) {
    const next = gate.queue[0]!;
    for (const active of gate.active) {
      if (!holdersCompatible(next, active)) return;
    }
    gate.queue.shift();
    gate.active.add(next);
    next.granted = true;
    next.grant(makeRelease(targetId, gate, next));
  }
}

function makeRelease(targetId: string, gate: TargetGate, waiter: Waiter): () => void {
  return () => {
    if (waiter.released) return;
    waiter.released = true;
    gate.active.delete(waiter);
    drainGate(targetId, gate);
    sweep(targetId, gate);
  };
}

function normalizedAccountKeys(keys: readonly string[] | undefined): readonly string[] {
  if (!keys?.length) {
    throw new Error("Account browser overlap requires at least one account identity");
  }
  const normalized = keys.map((key) => key.trim());
  if (normalized.some((key) => !key)) {
    throw new Error("Account browser overlap requires explicit account identities");
  }
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

/**
 * Acquire one overlap slot for one browser run. Cancelling the job while it
 * waits removes the waiter without consuming a grant; a grant that raced the
 * cancellation is released immediately so neither readers nor the writer flag
 * can leak.
 */
export async function acquireUnsignedBrowserOverlap(input: {
  targetId: string;
  mode: UnsignedBrowserOverlapMode;
  accountKeys?: readonly string[];
  accountSharing?: BrowserAccountOverlapSharing;
  jobId?: string;
}): Promise<() => void> {
  const targetId = input.targetId.trim();
  if (!targetId) throw new Error("Unsigned browser overlap requires an explicit target");
  const accountKeys = input.mode === "account" ? normalizedAccountKeys(input.accountKeys) : [];
  if (input.mode === "account" && !input.accountSharing) {
    throw new Error("Account browser overlap requires a sharing declaration");
  }
  const gate = gateFor(targetId);
  let waiter: Waiter | undefined;
  let grantedRelease: (() => void) | undefined;
  const granted = new Promise<() => void>((resolve) => {
    waiter = {
      mode: input.mode,
      accountKeys,
      accountSharing: input.accountSharing,
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
    accountKeys?: readonly string[];
    accountSharing?: BrowserAccountOverlapSharing;
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

function recipeSignInKeys(recipeGraph: Record<string, Recipe> | undefined): string[] {
  if (!recipeGraph) return [];
  try {
    return savedSignInKeysForRecipeGraph(recipeGraph);
  } catch {
    // A malformed graph cannot prove which credentials it uses. Treat it as
    // signed-in-unknown rather than as an unsigned independent reader.
    return ["unknown-sign-in"];
  }
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function validAccountOverlapForJob(job: {
  projectId?: string;
  browserAccountOverlap?: {
    accountKeys?: readonly string[];
    sharing?: string;
  };
  recipeGraph?: Record<string, Recipe>;
}): { accountKeys: string[]; sharing: BrowserAccountOverlapSharing } | undefined {
  const overlap = job.browserAccountOverlap;
  const projectId = job.projectId?.trim();
  if (!overlap || !projectId) return undefined;
  if (
    overlap.sharing !== "safe-shared-read" &&
    overlap.sharing !== "isolated-account" &&
    overlap.sharing !== "isolated-lane"
  ) {
    return undefined;
  }
  let keys: string[];
  try {
    keys = [...normalizedAccountKeys(overlap.accountKeys)];
  } catch {
    return undefined;
  }
  const graphKeys = recipeSignInKeys(job.recipeGraph);
  if (!graphKeys.length || graphKeys[0] === "unknown-sign-in" || !sameKeys(keys, graphKeys)) {
    return undefined;
  }
  // Saved sign-in keys are project-scoped logical account identities. Scoping
  // the gate key prevents two projects that both use "member" from collapsing
  // into one lane; equality still fails closed unless both tuples are exact.
  return {
    accountKeys: keys.map((key) => JSON.stringify([projectId, key])),
    sharing: overlap.sharing,
  };
}

/** Derive the overlap admission one browser proof job must hold while it
 * owns its ephemeral context. Fixture accounts and invoked Lanes already
 * carry their own serialization and never enter this gate; every other
 * browser run participates — independent classified unsigned runs as shared
 * readers, validated runtime-sign-in runs in their account lanes, and
 * everything else as the exclusive writer it already was when the shared lane
 * serialized it. In particular a recipe that mentions a saved sign-in but has
 * no validated local account identity can never pose as an unsigned reader. */
export function unsignedBrowserOverlapAdmissionForJob(job: {
  targetKind?: string;
  browserTargetId?: string;
  browserCaseProfile?: { authenticationFixtureId?: string };
  laneId?: string;
  browserIsolation?: "independent";
  browserAccountOverlap?: {
    accountKeys?: readonly string[];
    sharing?: string;
  };
  recipeGraph?: Record<string, Recipe>;
  projectId?: string;
  batchId?: string;
}):
  | {
      targetId: string;
      mode: UnsignedBrowserOverlapMode;
      accountKeys?: string[];
      accountSharing?: BrowserAccountOverlapSharing;
    }
  | undefined {
  if (job.targetKind !== "browser") return undefined;
  const targetId = job.browserTargetId?.trim();
  if (!targetId) return undefined;
  if (job.browserCaseProfile?.authenticationFixtureId?.trim()) return undefined;
  if (job.laneId?.trim()) return undefined;
  const accountOverlap = job.batchId?.trim() ? undefined : validAccountOverlapForJob(job);
  if (accountOverlap) {
    return {
      targetId,
      mode: "account",
      accountKeys: accountOverlap.accountKeys,
      accountSharing: accountOverlap.sharing,
    };
  }
  if (recipeSignInKeys(job.recipeGraph).length) {
    return { targetId, mode: "exclusive" };
  }
  return {
    targetId,
    mode: job.browserIsolation === "independent" ? "shared" : "exclusive",
  };
}

export function unsignedBrowserOverlapSnapshot(targetId: string): UnsignedBrowserOverlapSnapshot {
  const gate = gates.get(targetId);
  const active = [...(gate?.active ?? [])];
  return {
    readers: active.filter((waiter) => waiter.mode !== "exclusive").length,
    writerActive: active.some((waiter) => waiter.mode === "exclusive"),
    queued: gate?.queue.length ?? 0,
    queuedExclusive: gate?.queue.filter((waiter) => waiter.mode === "exclusive").length ?? 0,
  };
}

/** Test-only reset so one temporary state root cannot leak gate state into another. */
export function resetUnsignedBrowserOverlapForTests(): void {
  gates.clear();
}
