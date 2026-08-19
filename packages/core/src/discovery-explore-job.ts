/**
 * Server-owned explore crawl: here → ground? → do → verify → land.
 * Strategies match  naming: surface / journey / hard-edges.
 * Planner visits never imply live device location. The persisted navigation
 * cursor is the only proof of where Explore is; mismatches stop for review.
 */
import type {
  DiscoveryControl,
  DiscoveryExploreMode,
  DiscoveryExploreRun,
  DiscoveryExploreStopReason,
  DiscoveryExploreStrategy,
  DiscoverySession,
  NavigationProofCursorArtifact,
} from "@relay/protocol";
import {
  patchDiscoveryScope,
  readDiscoverySession,
  setDiscoveryStatus,
  writeDiscoveryExploreRun,
} from "./discovery.js";
import {
  runDiscoveryDo,
  runDiscoveryHere,
  type DiscoveryHere,
  type DiscoveryHereOption,
} from "./discovery-turn.js";
import { describeTargetUi } from "./explore.js";
import { groundTarget, GroundingError } from "./grounding.js";
import { currentOperationContext, runWithOperationContext } from "./operation-context.js";
import type { InteractInput } from "./workspace.js";

export type StartDiscoveryExploreOptions = {
  strategy?: DiscoveryExploreStrategy;
  mode?: DiscoveryExploreMode;
  maxDepth?: number;
};

type ActiveExploreJob = {
  cancel: boolean;
  promise?: Promise<void>;
  outcome: DiscoveryExploreRun;
};

const activeExploreJobs = new Map<string, ActiveExploreJob>();
const exploreOutcomes = new Map<string, DiscoveryExploreRun>();

const SURFACE_DEPTH = 2;
const JOURNEY_DEPTH = 6;
const HARD_EDGES_DEPTH = 4;

const AMBIGUOUS_LABELS = new Set([
  "menu",
  "private",
  "more",
  "options",
  "overflow",
  "drawer",
  "hamburger",
]);

const HARD_EDGE_RE =
  /(settings|permission|privacy|security|account|empty|no results|try again|offline|sign in|log in|notifications|accessibility|language|storage|battery)/i;

type PlannedVisit = {
  screenId: string;
  /** Remaining unopened control ids for this visit (surface BFS / journey DFS share the stack). */
  pendingIds: string[];
};

function provenCursor(
  here: DiscoveryHere,
  source: "screen-observation" | "transition",
): NavigationProofCursorArtifact {
  return {
    schemaVersion: 1,
    status: "proven",
    screenId: here.screen.id,
    proofToken: `discovery:${here.screen.fingerprint}`,
    source,
    updatedAt: Date.now(),
  };
}

function unknownCursor(
  prior: NavigationProofCursorArtifact | undefined,
  reason: string,
): NavigationProofCursorArtifact {
  return {
    schemaVersion: 1,
    status: "unknown",
    reason,
    updatedAt: Date.now(),
    ...(prior?.status === "proven"
      ? { previous: { screenId: prior.screenId, proofToken: prior.proofToken } }
      : prior?.previous
        ? { previous: prior.previous }
        : {}),
  };
}

function externalHandoffCursor(
  prior: NavigationProofCursorArtifact | undefined,
  foregroundApp: string,
  reason: string,
): NavigationProofCursorArtifact {
  return {
    schemaVersion: 1,
    status: "external-handoff",
    foregroundApp,
    reason,
    updatedAt: Date.now(),
    ...(prior?.status === "proven"
      ? { previous: { screenId: prior.screenId, proofToken: prior.proofToken } }
      : prior?.previous
        ? { previous: prior.previous }
        : {}),
  };
}

async function updateExploreCursor(
  sessionId: string,
  cursor: NavigationProofCursorArtifact,
): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  if (!job) return;
  job.outcome = { ...job.outcome, navigationCursor: cursor };
  await rememberExploreRun(sessionId, job.outcome);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function cancelled(sessionId: string): boolean {
  return activeExploreJobs.get(sessionId)?.cancel === true;
}

/** Default max depth for a -named strategy. */
export function defaultExploreDepth(strategy: DiscoveryExploreStrategy): number {
  if (strategy === "surface") return SURFACE_DEPTH;
  if (strategy === "hard-edges") return HARD_EDGES_DEPTH;
  return JOURNEY_DEPTH;
}

export function resolveExploreStrategy(
  scope: DiscoverySession["scope"],
  options?: StartDiscoveryExploreOptions,
): DiscoveryExploreStrategy {
  return options?.strategy ?? scope.strategy ?? "surface";
}

export function resolveExploreMode(
  scope: DiscoverySession["scope"],
  options?: StartDiscoveryExploreOptions,
): DiscoveryExploreMode {
  return options?.mode ?? scope.mode ?? "semantic";
}

export function resolveExploreMaxDepth(
  strategy: DiscoveryExploreStrategy,
  scope: DiscoverySession["scope"],
  options?: StartDiscoveryExploreOptions,
): number {
  return options?.maxDepth ?? scope.maxDepth ?? defaultExploreDepth(strategy);
}

/** Settings / permissions / empty-state style labels preferred by hard-edges. */
export function isHardEdgeLabel(label: string): boolean {
  return HARD_EDGE_RE.test(label.trim());
}

/** Prefer semantic chrome (Menu) and settings-ish rows before generic taps. */
export function isSemanticExploreLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (AMBIGUOUS_LABELS.has(normalized)) return true;
  if (/^(settings|appearance|haptics|widget|usage|advanced|voice|memory|account)$/i.test(label)) {
    return true;
  }
  return isHardEdgeLabel(label);
}

export function needsExploreGrounding(option: Pick<DiscoveryControl, "label" | "target">): boolean {
  const label = option.label.trim();
  if (AMBIGUOUS_LABELS.has(label.toLowerCase())) return true;
  if (
    !option.target.identifier &&
    !option.target.label &&
    !option.target.text &&
    option.target.point
  ) {
    return Boolean(label);
  }
  return false;
}

/**
 * Higher score = pick sooner. Surface/journey boost semantic options;
 * hard-edges boost settings/permissions-like labels hardest.
 */
export function scoreExploreOption(
  option: DiscoveryHereOption,
  strategy: DiscoveryExploreStrategy,
): number {
  if (option.opened) return Number.NEGATIVE_INFINITY;
  let score = 0;
  const label = option.label.trim();
  if (isSemanticExploreLabel(label)) score += 10;
  if (strategy === "hard-edges" && isHardEdgeLabel(label)) score += 40;
  if (strategy === "surface" && /^(ask|imagine|build|menu|settings)$/i.test(label)) score += 8;
  // Stable a11y ids beat anonymous points.
  if (option.target.identifier) score += 3;
  else if (option.target.label || option.target.text) score += 2;
  return score;
}

/** Pick the next unopened option; optional model mode is a stub that mirrors semantic. */
export function pickNextExploreOption(
  options: readonly DiscoveryHereOption[],
  strategy: DiscoveryExploreStrategy,
  mode: DiscoveryExploreMode = "semantic",
): DiscoveryHereOption | null {
  const candidates = options.filter((option) => !option.opened);
  if (!candidates.length) return null;
  // model mode: stub planner — same ranking as semantic until a real LLM planner lands.
  void mode;
  const ranked = [...candidates].sort((left, right) => {
    const delta = scoreExploreOption(right, strategy) - scoreExploreOption(left, strategy);
    if (delta !== 0) return delta;
    return left.label.localeCompare(right.label);
  });
  return ranked[0] ?? null;
}

/** In-process view of the crawl. Empty after a restart — use {@link loadDiscoveryExploreRun}. */
export function readDiscoveryExploreOutcome(sessionId: string): DiscoveryExploreRun | undefined {
  return exploreOutcomes.get(sessionId) ?? activeExploreJobs.get(sessionId)?.outcome;
}

/** Crawl record for a session, preferring live memory and falling back to disk. */
export async function loadDiscoveryExploreRun(
  sessionId: string,
): Promise<DiscoveryExploreRun | undefined> {
  const live = readDiscoveryExploreOutcome(sessionId);
  if (live) return live;
  return (await readDiscoverySession(sessionId))?.explore;
}

/** Cache the crawl record in memory and write it through to the session file. */
async function rememberExploreRun(sessionId: string, run: DiscoveryExploreRun): Promise<void> {
  exploreOutcomes.set(sessionId, run);
  try {
    await writeDiscoveryExploreRun(sessionId, run);
  } catch (error) {
    // A crawl must not fail because its bookkeeping could not be persisted.
    console.error(`discovery explore ${sessionId} outcome persist failed`, error);
  }
}

async function finishExplore(
  sessionId: string,
  status: "complete" | "stopped",
  reason: Omit<DiscoveryExploreStopReason, "at">,
): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  const stopReason: DiscoveryExploreStopReason = { ...reason, at: Date.now() };
  if (job) {
    // Cancel wins over a later device/error finish from the same crawl.
    if (job.outcome.stopReason?.code !== "cancelled") {
      job.outcome = { ...job.outcome, stopReason };
    }
    await rememberExploreRun(sessionId, job.outcome);
  } else {
    const prior = await loadDiscoveryExploreRun(sessionId);
    // A cancel already recorded on this session is the final word.
    if (prior && prior.stopReason?.code !== "cancelled") {
      await rememberExploreRun(sessionId, { ...prior, stopReason });
    }
  }
  const latest = await readDiscoverySession(sessionId);
  if (latest && (latest.status === "running" || latest.status === "paused")) {
    await setDiscoveryStatus(sessionId, status).catch(() => undefined);
  }
}

async function resolveInteraction(input: {
  serial: string;
  option: DiscoveryHereOption;
}): Promise<{ interaction: InteractInput; grounded: boolean }> {
  if (!needsExploreGrounding(input.option)) {
    const target = input.option.target;
    if (target.identifier) {
      return {
        interaction: { kind: "identifier", identifier: target.identifier },
        grounded: false,
      };
    }
    if (target.label) {
      return { interaction: { kind: "label", label: target.label }, grounded: false };
    }
    if (target.text) {
      return { interaction: { kind: "text-match", match: target.text }, grounded: false };
    }
    if (target.point) {
      return {
        interaction: { kind: "point", x: target.point.x, y: target.point.y },
        grounded: false,
      };
    }
    return { interaction: { kind: "label", label: input.option.label }, grounded: false };
  }

  try {
    const grounded = await groundTarget({
      serial: input.serial,
      target: input.option.label,
    });
    return { interaction: grounded.interaction, grounded: true };
  } catch (error) {
    if (error instanceof GroundingError) {
      // Fall back to the option's stored target so explore can continue.
      const target = input.option.target;
      if (target.point) {
        return {
          interaction: { kind: "point", x: target.point.x, y: target.point.y },
          grounded: false,
        };
      }
      if (target.label) {
        return { interaction: { kind: "label", label: target.label }, grounded: false };
      }
    }
    throw error;
  }
}

/**
 * Everything the crawl needs from a device, in one place.
 *
 * The loop below is the only crawl in Relay, so it has to be testable without
 * a phone. Tests swap this seam for an in-memory device and exercise the real
 * depth cap, back walk, and left-app stop rather than a copy of them.
 */
export type ExploreRuntime = {
  here: typeof runDiscoveryHere;
  act: typeof runDiscoveryDo;
  foreground: (serial: string) => Promise<string | undefined>;
};

export const liveExploreRuntime: ExploreRuntime = {
  here: runDiscoveryHere,
  act: runDiscoveryDo,
  foreground: async (serial) => (await describeTargetUi(serial)).foregroundApp ?? undefined,
};

let exploreRuntime: ExploreRuntime = liveExploreRuntime;

/** Swap the device seam. Tests only — production always uses the live runtime. */
export function setExploreRuntimeForTests(runtime: Partial<ExploreRuntime> | undefined): void {
  exploreRuntime = runtime ? { ...liveExploreRuntime, ...runtime } : liveExploreRuntime;
}

async function exploreBack(sessionId: string): Promise<DiscoveryHere> {
  const result = await exploreRuntime.act({
    sessionId,
    interaction: { kind: "key", key: "back" },
    decision: {
      mode: "semantic",
      provider: "relay",
      model: "explore-back-v1",
      selectedControlId: "back",
    },
  });
  return result.here;
}

async function runExploreJob(sessionId: string): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  if (!job) return;
  const { strategy, mode, maxDepth } = job.outcome;
  const runtime = exploreRuntime;

  // Yield so start→cancel wiring can stop before the first device snapshot.
  await delay(0);
  if (cancelled(sessionId)) {
    await finishExplore(sessionId, "stopped", {
      code: "cancelled",
      message: "Explore cancelled",
    });
    return;
  }

  try {
    let session = await readDiscoverySession(sessionId);
    if (!session) return;

    // Seed: here lands the live screen on the App Map.
    let here = await runtime.here(sessionId);
    session = (await readDiscoverySession(sessionId))!;
    const originApp = here.foregroundApp ?? (await runtime.foreground(session.targetId));
    const deadline = session.createdAt + session.scope.maxDurationMs;
    const explored = new Set<string>();
    await updateExploreCursor(sessionId, provenCursor(here, "screen-observation"));
    const stack: PlannedVisit[] = [
      {
        screenId: here.screen.id,
        pendingIds: here.options.filter((option) => !option.opened).map((option) => option.id),
      },
    ];

    while (!cancelled(sessionId) && Date.now() < deadline && stack.length) {
      session = (await readDiscoverySession(sessionId))!;
      if (!session || session.status !== "running") break;
      if (session.transitions.length >= session.scope.maxTransitions) break;
      if (session.screens.length >= session.scope.maxScreens) break;

      const depth = stack.length - 1;
      const frame = stack[stack.length - 1]!;

      if (depth > maxDepth || frame.pendingIds.length === 0) {
        stack.pop();
        if (stack.length) {
          const parent = stack[stack.length - 1]!;
          try {
            here = await exploreBack(sessionId);
          } catch (error) {
            await updateExploreCursor(
              sessionId,
              unknownCursor(job.outcome.navigationCursor, "Reviewed Back action failed"),
            );
            console.error(`discovery explore ${sessionId} back failed`, error);
            await finishExplore(sessionId, "stopped", {
              code: "error",
              message: error instanceof Error ? error.message : String(error),
            });
            return;
          }
          await updateExploreCursor(sessionId, provenCursor(here, "transition"));
          if (here.screen.id !== parent.screenId) {
            await finishExplore(sessionId, "stopped", {
              code: "error",
              message: `Back landed on ${here.screen.id}; expected ${parent.screenId}. Review this transition before resuming.`,
            });
            return;
          }
        }
        continue;
      }

      // Refresh options from the live here when the frame's screen matches.
      if (here.screen.id !== frame.screenId) {
        try {
          here = await runtime.here(sessionId);
        } catch (error) {
          console.error(`discovery explore ${sessionId} here failed`, error);
          await finishExplore(sessionId, "stopped", {
            code: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        if (here.screen.id !== frame.screenId) {
          await updateExploreCursor(sessionId, provenCursor(here, "screen-observation"));
          await finishExplore(sessionId, "stopped", {
            code: "error",
            message: `Explore is on ${here.screen.id}, not planned screen ${frame.screenId}. Review or teach the transition; Relay did not guess a recovery.`,
          });
          return;
        }
        await updateExploreCursor(sessionId, provenCursor(here, "screen-observation"));
        frame.pendingIds = here.options
          .filter((option) => !option.opened)
          .map((option) => option.id);
      }

      const next = pickNextExploreOption(
        here.options.filter((option) => frame.pendingIds.includes(option.id)),
        strategy,
        mode,
      );
      if (!next) {
        frame.pendingIds = [];
        continue;
      }
      frame.pendingIds = frame.pendingIds.filter((id) => id !== next.id);

      const edgeKey = `${frame.screenId}:${next.id}`;
      if (explored.has(edgeKey)) continue;
      explored.add(edgeKey);

      let interaction: InteractInput;
      try {
        const resolved = await resolveInteraction({
          serial: session.targetId,
          option: next,
        });
        interaction = resolved.interaction;
      } catch (error) {
        console.error(`discovery explore ${sessionId} ground failed`, error);
        continue;
      }

      let result: Awaited<ReturnType<typeof runDiscoveryDo>>;
      if (
        job.outcome.navigationCursor?.status !== "proven" ||
        job.outcome.navigationCursor.screenId !== frame.screenId
      ) {
        await updateExploreCursor(
          sessionId,
          unknownCursor(
            job.outcome.navigationCursor,
            `Action ${next.id} requires proof of ${frame.screenId}`,
          ),
        );
        await finishExplore(sessionId, "stopped", {
          code: "error",
          message: `Explore deferred ${next.label}: ${frame.screenId} is not currently proven.`,
        });
        return;
      }
      try {
        // Always act via do (verify + fresh here + land). Prefer grounded interaction
        // for ambiguous labels; otherwise controlId keeps provenance on the option.
        result = await runtime.act({
          sessionId,
          ...(needsExploreGrounding(next) ? { interaction } : { controlId: next.id, interaction }),
          decision: {
            mode: mode === "model" ? "model" : "semantic",
            provider: session.agent?.provider ?? "relay",
            model: session.agent?.model ?? `explore-${strategy}-v1`,
            selectedControlId: next.id,
          },
        });
      } catch (error) {
        await updateExploreCursor(
          sessionId,
          unknownCursor(job.outcome.navigationCursor, `Action ${next.id} failed before proof`),
        );
        console.error(`discovery explore ${sessionId} do failed`, error);
        await finishExplore(sessionId, "stopped", {
          code: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      here = result.here;
      const foregroundApp = here.foregroundApp ?? (await runtime.foreground(session.targetId));
      if (originApp && foregroundApp && foregroundApp !== originApp) {
        await updateExploreCursor(
          sessionId,
          externalHandoffCursor(
            job.outcome.navigationCursor,
            foregroundApp,
            `Action ${next.id} left ${originApp}`,
          ),
        );
        await finishExplore(sessionId, "stopped", {
          code: "left_app",
          message: `Opened ${foregroundApp} from ${originApp}. Relay preserved the handoff for review and did not reopen the app.`,
        });
        return;
      }

      await updateExploreCursor(sessionId, provenCursor(here, "transition"));

      const beforeId = frame.screenId;
      const afterId = here.screen.id;
      if (afterId === beforeId) {
        await delay(80);
        continue;
      }

      // currentDepth = stack.length - 1 (0 at seed). Cap hops by strategy maxDepth.
      if (stack.length - 1 >= maxDepth) {
        const parent = stack[stack.length - 1]!;
        try {
          here = await exploreBack(sessionId);
        } catch (error) {
          await updateExploreCursor(
            sessionId,
            unknownCursor(job.outcome.navigationCursor, "Depth-bound Back action failed"),
          );
          console.error(`discovery explore ${sessionId} return failed`, error);
          await finishExplore(sessionId, "stopped", {
            code: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        await updateExploreCursor(sessionId, provenCursor(here, "transition"));
        if (here.screen.id !== parent.screenId) {
          await finishExplore(sessionId, "stopped", {
            code: "error",
            message: `Back landed on ${here.screen.id}; expected ${parent.screenId}.`,
          });
          return;
        }
        await delay(80);
        continue;
      }

      stack.push({
        screenId: afterId,
        pendingIds: here.options.filter((option) => !option.opened).map((option) => option.id),
      });
      await delay(80);
    }

    if (cancelled(sessionId)) {
      await finishExplore(sessionId, "stopped", {
        code: "cancelled",
        message: "Explore cancelled",
      });
      return;
    }

    session = (await readDiscoverySession(sessionId))!;
    const hitBudget =
      !session ||
      Date.now() >= session.createdAt + session.scope.maxDurationMs ||
      session.transitions.length >= session.scope.maxTransitions ||
      session.screens.length >= session.scope.maxScreens;
    await finishExplore(sessionId, hitBudget ? "stopped" : "complete", {
      code: hitBudget ? "budget" : "complete",
      message: hitBudget ? "Explore hit screen, transition, or time budget" : "Explore finished",
    });
  } catch (error) {
    console.error(`discovery explore ${sessionId} failed`, error);
    await finishExplore(sessionId, "stopped", {
      code: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const jobStill = activeExploreJobs.get(sessionId);
    if (jobStill) await rememberExploreRun(sessionId, jobStill.outcome);
    activeExploreJobs.delete(sessionId);
  }
}

/** Start a server-owned explore crawl. The UI, CLI, and MCP all call this. */
export async function startDiscoveryExplore(
  id: string,
  options?: StartDiscoveryExploreOptions,
): Promise<DiscoverySession> {
  let session = await readDiscoverySession(id);
  if (!session) throw new Error("discovery session not found");
  if (!session.agent?.appMapId) {
    throw new Error("discovery explore needs an App Map to register screens");
  }
  if (session.status === "running" && activeExploreJobs.has(id)) return session;
  const interrupted = session.status === "running" && !activeExploreJobs.has(id);
  if (!interrupted && session.status !== "draft" && session.status !== "paused") {
    throw new Error(`cannot start discovery explore from ${session.status}`);
  }
  if (activeExploreJobs.has(id)) throw new Error("discovery explore is already active");

  const strategy = resolveExploreStrategy(session.scope, options);
  const mode = resolveExploreMode(session.scope, options);
  const maxDepth = resolveExploreMaxDepth(strategy, session.scope, options);

  if (
    options?.strategy ||
    options?.mode ||
    options?.maxDepth ||
    session.scope.strategy !== strategy ||
    session.scope.mode !== mode ||
    session.scope.maxDepth !== maxDepth
  ) {
    session = await patchDiscoveryScope(id, { strategy, mode, maxDepth });
  }

  const startedAt = Date.now();
  const outcome: DiscoveryExploreRun = {
    strategy,
    mode,
    maxDepth,
    startedAt,
    updatedAt: startedAt,
  };
  await rememberExploreRun(id, outcome);

  const running = interrupted ? session : await setDiscoveryStatus(id, "running");
  activeExploreJobs.set(id, { cancel: false, outcome });
  const operation = currentOperationContext();
  const handle = activeExploreJobs.get(id)!;
  const crawl = () => runExploreJob(id);
  handle.promise = (operation ? runWithOperationContext(operation, crawl) : crawl()).catch(
    () => undefined,
  );
  return running;
}

export async function cancelDiscoveryExplore(id: string): Promise<DiscoverySession> {
  const active = activeExploreJobs.get(id);
  if (active) active.cancel = true;
  const session = await readDiscoverySession(id);
  if (!session) throw new Error("discovery session not found");
  if (session.status === "running" || session.status === "paused") {
    const stopped = await setDiscoveryStatus(id, "stopped");
    const prior = (await loadDiscoveryExploreRun(id)) ?? active?.outcome;
    if (prior) {
      const cancelledRun: DiscoveryExploreRun = {
        ...prior,
        stopReason: { code: "cancelled", message: "Explore cancelled", at: Date.now() },
      };
      // The still-running crawl will finish with its own device error moments
      // from now. Stamp cancel onto the live job so finishExplore keeps it.
      if (active) active.outcome = cancelledRun;
      await rememberExploreRun(id, cancelledRun);
    }
    return stopped;
  }
  return session;
}

export function resetDiscoveryExploreJobsForTests(): void {
  activeExploreJobs.clear();
  exploreOutcomes.clear();
  exploreRuntime = liveExploreRuntime;
}

/** Drain a background explore job (tests only). */
export async function waitDiscoveryExploreForTests(id: string): Promise<void> {
  const job = activeExploreJobs.get(id);
  if (job?.promise) await job.promise.catch(() => undefined);
}
