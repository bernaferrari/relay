/**
 * Server-owned explore crawl: here → ground? → do → verify → land.
 * Explore strategies: surface / timeline / hard-edges.
 * Planner visits never imply live device location. The persisted navigation
 * cursor is the only proof of where Explore is; mismatches stop for review.
 */
import type {
  DiscoveryExploreCursor,
  DiscoveryExploreFixtureState,
  DiscoveryExploreRun,
  DiscoveryExploreProblem,
  DiscoveryExploreStopReason,
  DiscoveryExploreStrategy,
  DiscoverySession,
  NavigationProofCursorArtifact,
  StateFixture,
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
import { groundTarget } from "./grounding.js";
import { evaluateExplorationActionPolicy } from "./exploration-policy.js";
import { currentOperationContext, runWithOperationContext } from "./operation-context.js";
import type { InteractInput } from "./workspace.js";
import {
  cleanupExploreFixture,
  cursorState,
  delay,
  externalHandoffCursor,
  MAX_SAME_SCREEN_ACTIONS,
  needsExploreGrounding,
  policyActionForOption,
  prepareExploreFixture,
  provenCursor,
  resolveExploreInteraction,
  unknownCursor,
  type ExploreFixtureAdapter,
  type PlannedVisit,
} from "./discovery-explore-support.js";

export { needsExploreGrounding } from "./discovery-explore-support.js";
export type StartDiscoveryExploreOptions = {
  strategy?: DiscoveryExploreStrategy;
  maxDepth?: number;
  /** Reviewed, reversible state setup for an intentionally stateful crawl. */
  fixture?: StateFixture;
};

type ActiveExploreJob = {
  cancel: boolean;
  promise?: Promise<void>;
  outcome: DiscoveryExploreRun;
  fixture?: StateFixture;
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

async function updateExploreCursor(
  sessionId: string,
  cursor: NavigationProofCursorArtifact,
): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  if (!job) return;
  job.outcome = { ...job.outcome, navigationCursor: cursor };
  await rememberExploreRun(sessionId, job.outcome);
}

/** Persist the planner frontier separately from the device-location proof. */
async function persistExploreFrontier(
  sessionId: string,
  cursor: DiscoveryExploreCursor,
): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  if (!job) return;
  job.outcome = { ...job.outcome, cursor };
  await rememberExploreRun(sessionId, job.outcome);
}

function cancelled(sessionId: string): boolean {
  return activeExploreJobs.get(sessionId)?.cancel === true;
}

async function persistFixtureState(
  sessionId: string,
  state: DiscoveryExploreFixtureState,
): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  if (!job) return;
  job.outcome = { ...job.outcome, fixture: state };
  await rememberExploreRun(sessionId, job.outcome);
}

/** Default max depth for an explore strategy. */
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

/**
 * Higher score = pick sooner. Surface/timeline boost semantic options;
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

/** Pick the next unopened option using Relay's single explainable semantic policy. */
export function pickNextExploreOption(
  options: readonly DiscoveryHereOption[],
  strategy: DiscoveryExploreStrategy,
): DiscoveryHereOption | null {
  const candidates = options.filter((option) => !option.opened);
  if (!candidates.length) return null;
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

/** Cache the crawl record and durably write it before any dependent action.
 * Explore state is an execution fence, not optional bookkeeping. */
async function rememberExploreRun(sessionId: string, run: DiscoveryExploreRun): Promise<void> {
  exploreOutcomes.set(sessionId, run);
  await writeDiscoveryExploreRun(sessionId, run);
}

async function rememberExploreProblem(
  sessionId: string,
  problem: DiscoveryExploreProblem,
): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  if (!job) return;
  const problems = [...(job.outcome.problems ?? [])];
  const index = problems.findIndex(
    (item) => item.screenId === problem.screenId && item.controlId === problem.controlId,
  );
  if (index >= 0) problems[index] = problem;
  else problems.push(problem);
  job.outcome = { ...job.outcome, problems, updatedAt: Date.now() };
  await rememberExploreRun(sessionId, job.outcome);
}

async function finishExplore(
  sessionId: string,
  status: "complete" | "stopped",
  reason: Omit<DiscoveryExploreStopReason, "at">,
): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  const cleanupError = job
    ? await cleanupExploreFixture({
        state: job.outcome.fixture,
        adapter: exploreRuntime.fixture,
        persist: (state) => persistFixtureState(sessionId, state),
      })
    : undefined;
  if (cleanupError) {
    status = "stopped";
    reason = {
      code: "error",
      message: `Explore fixture cleanup failed: ${cleanupError.message}`,
    };
  }
  const stopReason: DiscoveryExploreStopReason = { ...reason, at: Date.now() };
  if (job) {
    // Cancel wins over a later device error, but never over an unproved
    // fixture cleanup: retained state is a stronger trust boundary.
    if (cleanupError || job.outcome.stopReason?.code !== "cancelled") {
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
  ground: typeof groundTarget;
  /** Device-owned fixture adapter. The crawl fails closed when a fixture is requested without it. */
  fixture?: ExploreFixtureAdapter;
};

export const liveExploreRuntime: ExploreRuntime = {
  here: runDiscoveryHere,
  act: runDiscoveryDo,
  foreground: async (serial) => (await describeTargetUi(serial)).foregroundApp ?? undefined,
  ground: groundTarget,
};

let exploreRuntime: ExploreRuntime = liveExploreRuntime;

/** Swap the device seam. Tests only — production always uses the live runtime. */
export function setExploreRuntimeForTests(runtime: Partial<ExploreRuntime> | undefined): void {
  exploreRuntime = runtime ? { ...liveExploreRuntime, ...runtime } : liveExploreRuntime;
}

/** Native Back can resolve before the destination has committed its tree. */
async function exploreBack(sessionId: string, expectedScreenId: string): Promise<DiscoveryHere> {
  const result = await exploreRuntime.act({
    sessionId,
    interaction: { kind: "key", key: "back" },
    land: false,
    decision: {
      mode: "semantic",
      provider: "relay",
      model: "explore-back-v1",
      selectedControlId: "back",
    },
  });
  if (result.here.screen.id === expectedScreenId) return result.here;
  await delay(550);
  return exploreRuntime.here(sessionId, { land: false });
}

async function runExploreJob(sessionId: string): Promise<void> {
  const job = activeExploreJobs.get(sessionId);
  if (!job) return;
  const { strategy, maxDepth } = job.outcome;
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

    if (job.fixture) {
      await prepareExploreFixture({
        fixture: job.fixture,
        prior: job.outcome.fixture,
        adapter: runtime.fixture,
        persist: (state) => persistFixtureState(sessionId, state),
      });
    }

    // Seed/restore: here is an observation only for Explore. Topology remains
    // a reviewable proposal until a person presses Keep.
    let here = await runtime.here(sessionId, { land: false });
    session = (await readDiscoverySession(sessionId))!;
    const originApp = here.foregroundApp ?? (await runtime.foreground(session.targetId));
    const deadline = session.createdAt + session.scope.maxDurationMs;
    const priorCursor = job.outcome.cursor;
    if (priorCursor?.inFlight) {
      await updateExploreCursor(
        sessionId,
        unknownCursor(
          job.outcome.navigationCursor,
          `Explore was interrupted while dispatching ${priorCursor.inFlight.controlId}; observe and review before resuming`,
        ),
      );
      await finishExplore(sessionId, "stopped", {
        code: "error",
        message: "Explore stopped after an interrupted action with unknown outcome",
      });
      return;
    }
    const explored = new Set(priorCursor?.exploredEdgeKeys ?? []);
    const sameScreenActions = new Map(
      Object.entries(priorCursor?.sameScreenActions ?? {}).map(([screenId, count]) => [
        screenId,
        count,
      ]),
    );
    const stack: PlannedVisit[] = priorCursor?.stack.length
      ? priorCursor.stack.map((frame) => ({
          screenId: frame.screenId,
          pendingIds: [...frame.pendingControlIds],
        }))
      : [
          {
            screenId: here.screen.id,
            pendingIds: here.options.filter((option) => !option.opened).map((option) => option.id),
          },
        ];
    const plannedScreen = stack.at(-1)?.screenId;
    if (plannedScreen && plannedScreen !== here.screen.id) {
      await updateExploreCursor(
        sessionId,
        unknownCursor(
          job.outcome.navigationCursor,
          `Explore resumed on ${here.screen.id}, but its durable frontier expects ${plannedScreen}`,
        ),
      );
      await finishExplore(sessionId, "stopped", {
        code: "error",
        message: `Explore cannot resume safely: target is on ${here.screen.id}, expected ${plannedScreen}`,
      });
      return;
    }
    await updateExploreCursor(
      sessionId,
      provenCursor(here, priorCursor ? "transition" : "screen-observation"),
    );
    await persistExploreFrontier(sessionId, cursorState({ stack, explored, sameScreenActions }));

    while (!cancelled(sessionId) && Date.now() < deadline && stack.length) {
      session = (await readDiscoverySession(sessionId))!;
      if (!session || session.status !== "running") break;
      if (session.transitions.length >= session.scope.maxTransitions) break;
      if (session.screens.length >= session.scope.maxScreens) break;

      const depth = stack.length - 1;
      const frame = stack[stack.length - 1]!;

      // Same-screen actions (for example an infinite feed) can reveal a new
      // control after the previous action. Reconcile the fresh observation
      // before deciding that an exhausted frame is ready to pop.
      if (depth <= maxDepth && frame.pendingIds.length === 0 && here.screen.id === frame.screenId) {
        frame.pendingIds = here.options
          .filter((option) => !option.opened)
          .map((option) => option.id)
          .filter((id) => !explored.has(`${frame.screenId}:${id}`));
      }

      if (depth > maxDepth || frame.pendingIds.length === 0) {
        stack.pop();
        if (stack.length) {
          const parent = stack[stack.length - 1]!;
          await persistExploreFrontier(
            sessionId,
            cursorState({
              stack,
              explored,
              sameScreenActions,
              inFlight: { screenId: here.screen.id, controlId: "back" },
            }),
          );
          try {
            here = await exploreBack(sessionId, parent.screenId);
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
        await persistExploreFrontier(
          sessionId,
          cursorState({ stack, explored, sameScreenActions }),
        );
        continue;
      }

      // Refresh options from the live here when the frame's screen matches.
      if (here.screen.id !== frame.screenId) {
        try {
          here = await runtime.here(sessionId, { land: false });
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

      // A feed may reveal additional rows after each same-screen action. Add
      // only candidates not already proven as edges; a moving list can never
      // make Explore replay an earlier action.
      frame.pendingIds = [
        ...new Set([
          ...frame.pendingIds,
          ...here.options
            .filter((option) => !option.opened)
            .map((option) => option.id)
            .filter((id) => !explored.has(`${frame.screenId}:${id}`)),
        ]),
      ];

      const next = pickNextExploreOption(
        here.options.filter((option) => frame.pendingIds.includes(option.id)),
        strategy,
      );
      if (!next) {
        frame.pendingIds = [];
        continue;
      }
      frame.pendingIds = frame.pendingIds.filter((id) => id !== next.id);

      const edgeKey = `${frame.screenId}:${next.id}`;
      if (explored.has(edgeKey)) continue;
      explored.add(edgeKey);

      const actionPolicy = evaluateExplorationActionPolicy({
        schemaVersion: 1,
        action: policyActionForOption(next),
        ...(job.fixture ? { fixture: job.fixture } : {}),
      });
      if (actionPolicy.authorization !== "allowed") {
        await rememberExploreProblem(sessionId, {
          screenId: frame.screenId,
          controlId: next.id,
          label: next.label,
          reason:
            actionPolicy.reasons[0]?.explanation ??
            "The deterministic exploration policy did not admit this action",
          capturedAt: Date.now(),
        });
        await persistExploreFrontier(
          sessionId,
          cursorState({ stack, explored, sameScreenActions }),
        );
        continue;
      }

      let interaction: InteractInput;
      try {
        const resolved = await resolveExploreInteraction({
          serial: session.targetId,
          option: next,
          ground: runtime.ground,
        });
        interaction = resolved.interaction;
      } catch (error) {
        await rememberExploreProblem(sessionId, {
          screenId: frame.screenId,
          controlId: next.id,
          label: next.label,
          reason: error instanceof Error ? error.message : String(error),
          capturedAt: Date.now(),
        });
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

      // Mark the command as in flight before dispatch. If the process dies
      // after the native command, resume must stop for review, never tap twice.
      await persistExploreFrontier(
        sessionId,
        cursorState({
          stack,
          explored,
          sameScreenActions,
          inFlight: { screenId: frame.screenId, controlId: next.id },
        }),
      );
      try {
        // Always act via do (verify + fresh here, never topology promotion).
        // Prefer grounded interaction for ambiguous labels; otherwise controlId
        // keeps provenance on the option.
        result = await runtime.act({
          sessionId,
          ...(needsExploreGrounding(next) ? { interaction } : { controlId: next.id, interaction }),
          land: false,
          decision: {
            mode: "semantic",
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
      await persistExploreFrontier(sessionId, cursorState({ stack, explored, sameScreenActions }));
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
        const sameScreenCount = (sameScreenActions.get(beforeId) ?? 0) + 1;
        sameScreenActions.set(beforeId, sameScreenCount);
        await persistExploreFrontier(
          sessionId,
          cursorState({ stack, explored, sameScreenActions }),
        );
        if (sameScreenCount >= MAX_SAME_SCREEN_ACTIONS) {
          await finishExplore(sessionId, "stopped", {
            code: "budget",
            message: `Explore stopped after ${MAX_SAME_SCREEN_ACTIONS} same-screen actions on ${beforeId}; possible infinite feed`,
          });
          return;
        }
        await delay(80);
        continue;
      }

      // currentDepth = stack.length - 1 (0 at seed). Cap hops by strategy maxDepth.
      if (stack.length - 1 >= maxDepth) {
        const parent = stack[stack.length - 1]!;
        await persistExploreFrontier(
          sessionId,
          cursorState({
            stack,
            explored,
            sameScreenActions,
            inFlight: { screenId: here.screen.id, controlId: "back" },
          }),
        );
        try {
          here = await exploreBack(sessionId, parent.screenId);
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
        await persistExploreFrontier(
          sessionId,
          cursorState({ stack, explored, sameScreenActions }),
        );
        await delay(80);
        continue;
      }

      stack.push({
        screenId: afterId,
        pendingIds: here.options.filter((option) => !option.opened).map((option) => option.id),
      });
      await persistExploreFrontier(sessionId, cursorState({ stack, explored, sameScreenActions }));
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
    const problemCount = job.outcome.problems?.length ?? 0;
    const stopped = hitBudget || problemCount > 0;
    await finishExplore(sessionId, stopped ? "stopped" : "complete", {
      code: hitBudget ? "budget" : problemCount > 0 ? "error" : "complete",
      message: hitBudget
        ? "Explore hit screen, transition, or time budget"
        : problemCount > 0
          ? `Explore finished with ${problemCount} unresolved problem${problemCount === 1 ? "" : "s"}`
          : "Explore finished",
    });
  } catch (error) {
    console.error(`discovery explore ${sessionId} failed`, error);
    await finishExplore(sessionId, "stopped", {
      code: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const jobStill = activeExploreJobs.get(sessionId);
    try {
      if (jobStill) await rememberExploreRun(sessionId, jobStill.outcome);
    } finally {
      activeExploreJobs.delete(sessionId);
    }
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
  const resuming = interrupted || session.status === "paused";
  if (!interrupted && session.status !== "draft" && session.status !== "paused") {
    throw new Error(`cannot start discovery explore from ${session.status}`);
  }
  if (activeExploreJobs.has(id)) throw new Error("discovery explore is already active");

  const strategy = resolveExploreStrategy(session.scope, options);
  const maxDepth = resolveExploreMaxDepth(strategy, session.scope, options);

  const prior = resuming ? await loadDiscoveryExploreRun(id) : undefined;
  if (resuming && prior?.stopReason) {
    throw new Error(
      `discovery explore already stopped (${prior.stopReason.code}); create a new session to explore again`,
    );
  }
  if (
    resuming &&
    (prior?.navigationCursor?.status === "unknown" ||
      prior?.navigationCursor?.status === "external-handoff")
  ) {
    throw new Error(
      "discovery explore cannot resume from an unknown or external target position; capture and review the current screen first",
    );
  }
  if (resuming && prior?.cursor?.inFlight) {
    throw new Error(
      `discovery explore cannot resume after interrupted action ${prior.cursor.inFlight.controlId}; review the current target before starting a new session`,
    );
  }
  if (
    resuming &&
    ((options?.strategy && options.strategy !== prior?.strategy) ||
      (options?.maxDepth !== undefined && options.maxDepth !== prior?.maxDepth))
  ) {
    throw new Error("discovery explore resume options must match the persisted crawl");
  }
  if (
    options?.fixture &&
    prior?.fixture &&
    (options.fixture.id !== prior.fixture.definition.id ||
      options.fixture.review.revision !== prior.fixture.definition.review.revision)
  ) {
    throw new Error("discovery explore resume fixture must match the persisted reviewed fixture");
  }

  if (
    options?.strategy ||
    options?.maxDepth ||
    session.scope.strategy !== strategy ||
    session.scope.maxDepth !== maxDepth
  ) {
    session = await patchDiscoveryScope(id, { strategy, maxDepth });
  }

  const startedAt = prior?.startedAt ?? Date.now();
  const fixture = options?.fixture ?? prior?.fixture?.definition;
  const outcome: DiscoveryExploreRun = prior ?? {
    strategy,
    maxDepth,
    ...(fixture
      ? {
          fixture: {
            definition: structuredClone(fixture),
            phase: "cleaned" as const,
          },
        }
      : {}),
    startedAt,
    updatedAt: startedAt,
  };
  await rememberExploreRun(id, outcome);

  const running = interrupted ? session : await setDiscoveryStatus(id, "running");
  activeExploreJobs.set(id, {
    cancel: false,
    outcome,
    ...(fixture ? { fixture: structuredClone(fixture) } : {}),
  });
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
