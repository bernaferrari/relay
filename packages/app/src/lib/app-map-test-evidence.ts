import type { AppMapCompiledTest, AppMapTestStepProvenance } from "@relay/protocol";
import type { JobInfo, PersistedRun } from "./api-types";

export type AppMapTestRun = JobInfo | PersistedRun;

export type AppMapTestStepRunState =
  | "queued"
  | "running"
  | "paused"
  | "passed"
  | "healed"
  | "failed"
  | "partial"
  | "unobserved";

export type AppMapTestStepOutcome = {
  testStepId: string;
  state: AppMapTestStepRunState;
  observedRecipeSteps: number;
  totalRecipeSteps: number;
  frames: number;
  events: number;
  artifacts: number;
  durationMs?: number;
  latestFrame?: NonNullable<AppMapTestRun["frames"]>[number];
  failure?: { message?: string; category?: string };
};

export type AppMapTestRunFailure = {
  testStepId?: string;
  recipeStepId?: string;
  message?: string;
  category?: string;
};

function runTime(run: AppMapTestRun): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt ?? 0;
}

/**
 * A scenario Test does not own a run until its deterministic root recipe has
 * actually been executed. Matching by title or map id would quietly attach
 * unrelated evidence, so this projection intentionally requires a compiled
 * plan and the exact root recipe id.
 */
export function latestRunForCompiledTest(
  plan: AppMapCompiledTest | undefined,
  live: readonly JobInfo[],
  persisted: readonly PersistedRun[],
): AppMapTestRun | undefined {
  if (!plan) return undefined;
  const byId = new Map<string, AppMapTestRun>();
  for (const run of persisted) {
    if (run.action === plan.rootRecipeId) byId.set(run.id, run);
  }
  for (const run of live) {
    if (run.action === plan.rootRecipeId) byId.set(run.id, run);
  }
  return [...byId.values()].toSorted((left, right) => runTime(right) - runTime(left))[0];
}

export function provenanceForTestStep(
  plan: AppMapCompiledTest | undefined,
  stepId: string | undefined,
): AppMapTestStepProvenance[] {
  if (!plan) return [];
  const rows = stepId
    ? plan.stepProvenance.filter((item) => item.testStepId === stepId)
    : plan.stepProvenance;
  return rows.toSorted(
    (left, right) =>
      left.recipeId.localeCompare(right.recipeId) ||
      left.stepIndex - right.stepIndex ||
      left.recipeStepId.localeCompare(right.recipeStepId),
  );
}

export function runEvidenceCounts(run: AppMapTestRun | undefined): {
  frames: number;
  events: number;
  artifacts: number;
} {
  return {
    frames: run?.frames?.length ?? 0,
    events: run?.evidence?.events?.length ?? 0,
    artifacts: run?.artifacts?.length ?? 0,
  };
}

export function runObservedAt(run: AppMapTestRun | undefined): number | undefined {
  if (!run) return undefined;
  const value = runTime(run);
  return value > 0 ? value : undefined;
}

function traceState(trace: NonNullable<AppMapTestRun["steps"]>[number]): AppMapTestStepRunState {
  if (trace.status === "error" || trace.tone === "fail" || trace.tone === "danger") {
    return "failed";
  }
  if (trace.status === "healed" || Boolean(trace.heal)) return "healed";
  if (trace.status === "paused") return "paused";
  if (trace.status === "running" && trace.finishedAt === undefined) return "running";
  if (trace.status === "ok" || trace.finishedAt !== undefined) return "passed";
  return "unobserved";
}

function safeTraceByIndex(
  run: AppMapTestRun,
): Map<number, NonNullable<AppMapTestRun["steps"]>[number]> {
  const grouped = new Map<number, NonNullable<AppMapTestRun["steps"]>>();
  for (const trace of run.steps ?? []) {
    grouped.set(trace.index, [...(grouped.get(trace.index) ?? []), trace]);
  }
  return new Map(
    [...grouped].flatMap(([index, traces]) =>
      traces.length === 1 ? [[index, traces[0]!] as const] : [],
    ),
  );
}

/**
 * Projects immutable runtime observations back to one authored Test step.
 * Only provenance in the executed root recipe is eligible: nested recipes do
 * not currently expose a trace join, so attributing their outcomes would be a
 * guess. Duplicate trace indexes are also excluded rather than guessed.
 */
export function outcomeForTestStep(
  plan: AppMapCompiledTest | undefined,
  run: AppMapTestRun | undefined,
  testStepId: string | undefined,
): AppMapTestStepOutcome | undefined {
  if (!plan || !run || !testStepId || run.action !== plan.rootRecipeId) return undefined;
  const root = plan.recipes[plan.rootRecipeId];
  if (!root) return undefined;
  const expected = plan.stepProvenance.filter(
    (item) => item.testStepId === testStepId && item.recipeId === plan.rootRecipeId,
  );
  const traces = safeTraceByIndex(run);
  const observed = expected.flatMap((item) => {
    if (root.steps[item.stepIndex]?.id !== item.recipeStepId) return [];
    const trace = traces.get(item.stepIndex);
    return trace ? [{ item, trace, state: traceState(trace) }] : [];
  });
  const traceIds = new Set(observed.map(({ trace }) => trace.id));
  const frames = observed.flatMap(({ trace }) => trace.frames ?? []);
  const events = (run.evidence?.events ?? []).filter(
    (event) => event.stepId && traceIds.has(event.stepId),
  );
  const artifacts = (run.artifacts ?? []).filter((artifact) => {
    if (!artifact.data || typeof artifact.data !== "object") return false;
    const stepId = (artifact.data as { stepId?: unknown }).stepId;
    return typeof stepId === "string" && traceIds.has(stepId);
  });
  const states = observed.map(({ state }) => state);
  const state: AppMapTestStepRunState = states.includes("failed")
    ? "failed"
    : states.includes("paused")
      ? "paused"
      : states.includes("running")
        ? "running"
        : expected.length > 0 && observed.length === expected.length
          ? states.includes("healed")
            ? "healed"
            : "passed"
          : observed.length > 0
            ? "partial"
            : run.status === "queued"
              ? "queued"
              : "unobserved";
  const failed = observed.find(({ state: observedState }) => observedState === "failed");
  const durations = observed
    .map(({ trace }) => trace.durationMs)
    .filter((value): value is number => value !== undefined);
  return {
    testStepId,
    state,
    observedRecipeSteps: observed.length,
    totalRecipeSteps: expected.length,
    frames: frames.length,
    events: events.length,
    artifacts: artifacts.length,
    ...(observed.length > 0 && durations.length === observed.length
      ? { durationMs: durations.reduce((total, duration) => total + duration, 0) }
      : {}),
    ...(frames.at(-1) ? { latestFrame: frames.at(-1) } : {}),
    ...(failed
      ? {
          failure: {
            ...(run.error || failed.trace.log ? { message: run.error ?? failed.trace.log } : {}),
            ...(run.failureCategory ? { category: run.failureCategory } : {}),
          },
        }
      : {}),
  };
}

export function failureForTestRun(
  plan: AppMapCompiledTest | undefined,
  run: AppMapTestRun | undefined,
): AppMapTestRunFailure | undefined {
  if (!plan || !run || run.action !== plan.rootRecipeId || run.status !== "error") return undefined;
  const root = plan.recipes[plan.rootRecipeId];
  const failed = [...safeTraceByIndex(run)]
    .toSorted(([left], [right]) => left - right)
    .find(([, trace]) => traceState(trace) === "failed");
  const recipeStepId = failed && root?.steps[failed[0]]?.id;
  const provenance = recipeStepId
    ? plan.stepProvenance.find(
        (item) => item.recipeId === plan.rootRecipeId && item.recipeStepId === recipeStepId,
      )
    : undefined;
  return {
    ...(provenance ? { testStepId: provenance.testStepId } : {}),
    ...(recipeStepId ? { recipeStepId } : {}),
    ...(run.error || failed?.[1].log ? { message: run.error ?? failed?.[1].log } : {}),
    ...(run.failureCategory ? { category: run.failureCategory } : {}),
  };
}
