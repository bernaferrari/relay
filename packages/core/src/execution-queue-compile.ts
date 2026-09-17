import type {
  AppMap,
  AppMapScenarioTest,
  CaptureRasterPolicy,
  ExecutionQueue,
  ExecutionQueueDurationQuote,
  RecipeStep,
} from "@relay/protocol";
import {
  CAPTURE_REVIEW_DEST_PHASE,
  destEndConnectionsAreChromeInspect,
  executionQueueForTest,
  quoteDeclaredExecutionQueues,
  sequenceAfterIsPlaceholder,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { AppMapTestCompileError } from "./app-map-test-compile-error.js";

export function destEndChromeInspectForTest(map: AppMap, test: AppMapScenarioTest): boolean {
  const connections = test.steps.flatMap((step) => {
    if (
      step.kind !== "instruction" ||
      step.binding.status !== "resolved" ||
      step.binding.kind !== "connections"
    ) {
      return [];
    }
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

function estimateStepDuration(
  step: RecipeStep,
  graph: Readonly<Record<string, Recipe>>,
  visiting: ReadonlySet<string>,
): number {
  if (step.kind === "sleep") return step.ms;
  if (step.kind === "tap" || step.kind === "key" || step.kind === "swipe") return 700;
  if (step.kind === "screenshot") return 350;
  if (step.kind === "app" || step.kind === "device") return 1_200;
  if (step.kind === "tour") {
    const stops = step.fallbackStops?.length ?? 1;
    return Math.max(2_000, stops * 1_800);
  }
  if (step.kind === "module" || step.kind === "repeat") {
    const nested = graph[step.recipeId];
    if (!nested || visiting.has(nested.id)) return 0;
    const duration = estimateRecipeDuration(nested, graph, new Set(visiting).add(nested.id));
    return step.kind === "repeat" ? duration * step.count : duration;
  }
  if (step.kind === "branch") {
    const branches = [step.thenRecipeId, step.elseRecipeId]
      .map((id) => (id ? graph[id] : undefined))
      .filter((recipe): recipe is Recipe => Boolean(recipe));
    return Math.max(
      0,
      ...branches.map((recipe) =>
        visiting.has(recipe.id)
          ? 0
          : estimateRecipeDuration(recipe, graph, new Set(visiting).add(recipe.id)),
      ),
    );
  }
  return 500;
}

export function estimateRecipeDuration(
  recipe: Recipe,
  graph: Readonly<Record<string, Recipe>>,
  visiting: ReadonlySet<string>,
): number {
  return recipe.steps.reduce(
    (total, step) => total + estimateStepDuration(step, graph, visiting),
    0,
  );
}

export function quoteCompiledTestDuration(
  recipe: Recipe,
  graph: Readonly<Record<string, Recipe>>,
  executionQueue: ExecutionQueue | undefined,
): ExecutionQueueDurationQuote[] {
  return quoteDeclaredExecutionQueues(
    [
      {
        executionQueue,
        workMs: estimateRecipeDuration(recipe, graph, new Set([recipe.id])),
        requiredDwellMs: declaredDwellMsFromRecipeGraph(graph, recipe.id),
      },
    ],
    1,
  );
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
