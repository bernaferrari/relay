import type { AppMapCompiledTest, AppMapTestStepProvenance } from "@relay/protocol";
import type { JobInfo, PersistedRun } from "./api-types";

export type AppMapTestRun = JobInfo | PersistedRun;

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
