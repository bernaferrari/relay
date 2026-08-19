/**
 * Server-owned explore crawl: here → ground? → do → verify → land.
 * Strategies match  naming: surface / journey / hard-edges.
 * Leave-app recovery is one soft openApp max — never relaunch spam.
 */
import type {
  DiscoveryControl,
  DiscoveryExploreMode,
  DiscoveryExploreStrategy,
  DiscoverySession,
} from "@relay/protocol";
import { patchDiscoveryScope, readDiscoverySession, setDiscoveryStatus } from "./discovery.js";
import {
  runDiscoveryDo,
  runDiscoveryHere,
  type DiscoveryHere,
  type DiscoveryHereOption,
} from "./discovery-turn.js";
import { createDevice, openApp } from "./device.js";
import { describeTargetUi } from "./explore.js";
import { groundTarget, GroundingError } from "./grounding.js";
import { currentOperationContext, runWithOperationContext } from "./operation-context.js";
import { runWithTargetContext } from "./target-context.js";
import { devicePlatformForSerial, type InteractInput } from "./workspace.js";

export type DiscoveryExploreStopCode = "complete" | "cancelled" | "budget" | "left_app" | "error";

export type DiscoveryExploreStopReason = {
  code: DiscoveryExploreStopCode;
  message: string;
  at: number;
};

export type DiscoveryExploreOutcome = {
  strategy: DiscoveryExploreStrategy;
  mode: DiscoveryExploreMode;
  maxDepth: number;
  stopReason?: DiscoveryExploreStopReason;
  softRecoveries: number;
};

export type StartDiscoveryExploreOptions = {
  strategy?: DiscoveryExploreStrategy;
  mode?: DiscoveryExploreMode;
  maxDepth?: number;
};

type ActiveExploreJob = {
  cancel: boolean;
  promise?: Promise<void>;
  outcome: DiscoveryExploreOutcome;
};

const activeExploreJobs = new Map<string, ActiveExploreJob>();
const exploreOutcomes = new Map<string, DiscoveryExploreOutcome>();

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

type Frame = {
  screenId: string;
  /** Remaining unopened control ids for this visit (surface BFS / journey DFS share the stack). */
  pendingIds: string[];
};

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

export function readDiscoveryExploreOutcome(
  sessionId: string,
): DiscoveryExploreOutcome | undefined {
  return exploreOutcomes.get(sessionId) ?? activeExploreJobs.get(sessionId)?.outcome;
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
    exploreOutcomes.set(sessionId, job.outcome);
  } else {
    const prior = exploreOutcomes.get(sessionId);
    if (prior?.stopReason?.code === "cancelled") {
      /* keep */
    } else if (prior) {
      exploreOutcomes.set(sessionId, { ...prior, stopReason });
    }
  }
  const latest = await readDiscoverySession(sessionId);
  if (latest && (latest.status === "running" || latest.status === "paused")) {
    await setDiscoveryStatus(sessionId, status).catch(() => undefined);
  }
}

/**
 * Soft return to the origin app once. Never relaunches as the primary recovery path.
 * Returns left_app when still outside after the single soft recover (or when the
 * soft recover budget was already spent).
 */
export function decideSoftRecover(input: {
  foregroundApp?: string;
  originApp?: string;
  softRecoveries: number;
  maxSoftRecoveries?: number;
}): "ok" | "attempt_recover" | "left_app" {
  if (!input.originApp) return "ok";
  if (!input.foregroundApp || input.foregroundApp === input.originApp) return "ok";
  const max = input.maxSoftRecoveries ?? 1;
  if (input.softRecoveries >= max) return "left_app";
  return "attempt_recover";
}

export async function softRecoverOriginApp(input: {
  serial: string;
  originApp?: string;
  softRecoveries: number;
  maxSoftRecoveries?: number;
}): Promise<"ok" | "recovered" | "left_app"> {
  const foreground = (await describeTargetUi(input.serial)).foregroundApp ?? undefined;
  const decision = decideSoftRecover({
    foregroundApp: foreground,
    originApp: input.originApp,
    softRecoveries: input.softRecoveries,
    maxSoftRecoveries: input.maxSoftRecoveries,
  });
  if (decision === "ok") return "ok";
  if (decision === "left_app") return "left_app";
  const platform = (await devicePlatformForSerial(input.serial)) ?? "android";
  await runWithTargetContext({ kind: "device", platform, serial: input.serial }, async () => {
    await openApp(createDevice(), input.originApp!, { relaunch: false });
  });
  const back = (await describeTargetUi(input.serial)).foregroundApp;
  return back === input.originApp ? "recovered" : "left_app";
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

async function exploreBack(sessionId: string): Promise<DiscoveryHere> {
  const result = await runDiscoveryDo({
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
    let here = await runDiscoveryHere(sessionId);
    session = (await readDiscoverySession(sessionId))!;
    const originApp =
      here.foregroundApp ?? (await describeTargetUi(session.targetId)).foregroundApp;
    const deadline = session.createdAt + session.scope.maxDurationMs;
    const explored = new Set<string>();
    const stack: Frame[] = [
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
          try {
            here = await exploreBack(sessionId);
          } catch (error) {
            console.error(`discovery explore ${sessionId} back failed`, error);
            await finishExplore(sessionId, "stopped", {
              code: "error",
              message: error instanceof Error ? error.message : String(error),
            });
            return;
          }
        }
        continue;
      }

      // Refresh options from the live here when the frame's screen matches.
      if (here.screen.id !== frame.screenId) {
        try {
          here = await runDiscoveryHere(sessionId);
        } catch (error) {
          console.error(`discovery explore ${sessionId} here failed`, error);
          await finishExplore(sessionId, "stopped", {
            code: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        if (here.screen.id !== frame.screenId) {
          // Lost the expected screen — back toward parent.
          stack.pop();
          continue;
        }
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
      try {
        // Always act via do (verify + fresh here + land). Prefer grounded interaction
        // for ambiguous labels; otherwise controlId keeps provenance on the option.
        result = await runDiscoveryDo({
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
        console.error(`discovery explore ${sessionId} do failed`, error);
        continue;
      }

      here = result.here;

      const leave = await softRecoverOriginApp({
        serial: session.targetId,
        originApp,
        softRecoveries: job.outcome.softRecoveries,
      });
      if (leave === "recovered") {
        job.outcome.softRecoveries += 1;
        try {
          here = await runDiscoveryHere(sessionId);
        } catch {
          /* continue with prior here */
        }
      } else if (leave === "left_app") {
        await finishExplore(sessionId, "stopped", {
          code: "left_app",
          message: `Left origin app ${originApp ?? "(unknown)"}; soft recover budget exhausted`,
        });
        return;
      }

      const beforeId = frame.screenId;
      const afterId = here.screen.id;
      if (afterId === beforeId) {
        await delay(80);
        continue;
      }

      // currentDepth = stack.length - 1 (0 at seed). Cap hops by strategy maxDepth.
      if (stack.length - 1 >= maxDepth) {
        try {
          here = await exploreBack(sessionId);
        } catch (error) {
          console.error(`discovery explore ${sessionId} return failed`, error);
          await finishExplore(sessionId, "stopped", {
            code: "error",
            message: error instanceof Error ? error.message : String(error),
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
    if (jobStill) exploreOutcomes.set(sessionId, jobStill.outcome);
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

  const outcome: DiscoveryExploreOutcome = {
    strategy,
    mode,
    maxDepth,
    softRecoveries: 0,
  };
  exploreOutcomes.set(id, outcome);

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
    const prior = exploreOutcomes.get(id) ?? active?.outcome;
    if (prior) {
      exploreOutcomes.set(id, {
        ...prior,
        stopReason: {
          code: "cancelled",
          message: "Explore cancelled",
          at: Date.now(),
        },
      });
    }
    return stopped;
  }
  return session;
}

export function resetDiscoveryExploreJobsForTests(): void {
  activeExploreJobs.clear();
  exploreOutcomes.clear();
}

/** Drain a background explore job (tests only). */
export async function waitDiscoveryExploreForTests(id: string): Promise<void> {
  const job = activeExploreJobs.get(id);
  if (job?.promise) await job.promise.catch(() => undefined);
}
