import type {
  AppMap,
  AppMapScenarioTest,
  CaptureRasterPolicy,
  ExecutionQueue,
  RecipeStep,
} from "@relay/protocol";
import {
  CAPTURE_REVIEW_DEST_PHASE,
  destEndConnectionsAreChromeInspect,
  executionQueueForTest,
  sequenceAfterIsPlaceholder,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { AppMapTestCompileError } from "./app-map-test-compile-error.js";

export function destEndChromeInspectForTest(map: AppMap, test: AppMapScenarioTest): boolean {
  const connections = test.steps.flatMap((step) => {
    if (step.kind !== "instruction" || step.binding.kind !== "connections") return [];
    return step.binding.connectionIds.flatMap((id) => {
      const connection = map.connections[id];
      return connection ? [connection] : [];
    });
  });
  return destEndConnectionsAreChromeInspect(connections);
}

export function resolvedExecutionQueue(
  map: AppMap,
  test: AppMapScenarioTest,
): ExecutionQueue | undefined {
  return executionQueueForTest({
    executionQueue: test.executionQueue,
    destEndChromeInspect: destEndChromeInspectForTest(map, test),
  });
}

export function declaredDwellMsFromRecipeGraph(
  graph: Readonly<Record<string, Recipe>>,
  rootRecipeId: string,
): number {
  let max = 0;
  const visit = (recipeId: string, stack: ReadonlySet<string>): void => {
    if (stack.has(recipeId)) return;
    const recipe = graph[recipeId];
    if (!recipe) return;
    const next = new Set(stack).add(recipeId);
    for (const step of recipe.steps) {
      if (step.kind === "sleep") max = Math.max(max, step.ms);
      if (step.kind === "screenshot") {
        for (const phase of step.review?.phases ?? []) {
          if (phase.intervalMs) max = Math.max(max, phase.intervalMs);
        }
      }
      if (step.kind === "app" && step.action === "background" && step.backgroundMs) {
        max = Math.max(max, step.backgroundMs);
      }
      if (step.kind === "module" || step.kind === "repeat") visit(step.recipeId, next);
      if (step.kind === "branch") {
        if (step.thenRecipeId) visit(step.thenRecipeId, next);
        if (step.elseRecipeId) visit(step.elseRecipeId, next);
      }
    }
  };
  visit(rootRecipeId, new Set());
  return max;
}

function screenshotUsesPlaceholderAsAfter(step: RecipeStep): boolean {
  if (step.kind !== "screenshot") return false;
  return sequenceAfterIsPlaceholder({
    phase: step.review?.phase,
    lookFor: step.review?.lookFor,
    caption: step.caption,
    phases: step.review?.phases,
  });
}

export function assertCompiledExecutionQueue(
  test: AppMapScenarioTest,
  graph: Readonly<Record<string, Recipe>>,
  queue: ExecutionQueue | undefined,
): void {
  if (queue !== "live-output") return;
  for (const recipe of Object.values(graph)) {
    for (const step of recipe.steps) {
      if (!screenshotUsesPlaceholderAsAfter(step)) continue;
      throw new AppMapTestCompileError(
        "unsafe-execution-queue",
        test.id,
        step.id ?? test.steps[0]?.id ?? test.id,
        "Live-output Sequence after cannot be a loading placeholder",
      );
    }
  }
}

/** Dest-end capture-review is Fast unless the checkpoint already opted into
 *  Stable or Sequence. Queue (fast-ui / live-output / survival) is scheduling,
 *  not raster policy — a live-output dest-end still takes one dest image. */
export function destEndInspectScreenshotReview(
  lookFor: string,
  policy?: CaptureRasterPolicy,
): {
  mode: "later";
  lookFor: string;
  phase: typeof CAPTURE_REVIEW_DEST_PHASE;
  policy: CaptureRasterPolicy;
} {
  return {
    mode: "later",
    lookFor,
    phase: CAPTURE_REVIEW_DEST_PHASE,
    policy: policy === "stable" || policy === "sequence" ? policy : "fast",
  };
}
