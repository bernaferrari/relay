import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  RecipeStep,
  ReviewedDocumentOriginProjection,
} from "@relay/protocol";
import { destEndCaptureWaitForIndex } from "./app-map-compiler.js";
import { destEndInspectScreenshotReview } from "./execution-queue-compile.js";
import {
  AppMapTestCompileError,
  type AppMapTestCompileErrorCode,
} from "./app-map-test-compile-error.js";
import type { Recipe } from "./recipes.js";

export const MAX_COMPILED_STEPS = 4_096;
/** Bounded automatic survey using the `target.scroll-survey.capture` default. */
export const DESTINATION_SURVEY_MAX_SCROLLS = 4;

export function destEndCaptureScreenshot(step: AppMapScenarioTestStep): RecipeStep {
  return {
    kind: "screenshot",
    caption: `step:${step.id}:${step.intent}`,
    review: destEndInspectScreenshotReview(step.intent),
    id: `relay-test-${step.id}-dest`,
  };
}

export function insertDestEndCaptureReviewScreenshot(
  recipe: { steps: RecipeStep[] },
  screenshot: RecipeStep,
): boolean {
  if (screenshot.id && recipe.steps.some((step) => step.id === screenshot.id)) return true;
  const destIndex = destEndCaptureWaitForIndex(recipe.steps);
  if (destIndex < 0) return false;
  recipe.steps.splice(destIndex + 1, 0, structuredClone(screenshot));
  return true;
}

/** Stamp dest wait-for before provenance import so leftover Close last-frame
 * does not inherit the dest screenshot's stepIndex. */
export function stampDestEndCaptureReviewScreenshots(
  recipes: Iterable<{ id: string; steps: RecipeStep[] }>,
  destRecipe: { id: string; steps: RecipeStep[] } | undefined,
  destEndIds: ReadonlySet<string>,
  screenshot: RecipeStep,
): void {
  const seen = new Set<string>();
  const ordered = destRecipe ? [destRecipe, ...recipes] : [...recipes];
  for (const recipe of ordered) {
    if (seen.has(recipe.id)) continue;
    if (destRecipe && recipe !== destRecipe && !destEndIds.has(recipe.id)) continue;
    seen.add(recipe.id);
    insertDestEndCaptureReviewScreenshot(recipe, screenshot);
  }
}

export type AppMapTestCompileOptions = {
  startupMode?: "warm" | "cold";
  runtimeTargetProfile?: import("@relay/protocol").AppMapCompiledRuntimeTargetProfile;
  forceRecaptureSurfaceScreenIds?: readonly string[];
  entryCheckpointScreenId?: string;
  reviewedDocumentOrigins?: readonly ReviewedDocumentOriginProjection[];
};

export function fail(
  code: AppMapTestCompileErrorCode,
  test: AppMapScenarioTest,
  step: AppMapScenarioTestStep,
  message: string,
): never {
  throw new AppMapTestCompileError(code, test.id, step.id, message);
}

export function recipeId(map: AppMap, test: AppMapScenarioTest, suffix = "root"): string {
  return `app-map:${map.id}:test:${test.id}:${suffix}:r${map.revision}`;
}

export function asRecipe(
  map: AppMap,
  compiled: { id: string; title: string; description?: string; steps: RecipeStep[] },
): Recipe {
  return {
    id: compiled.id,
    title: compiled.title,
    ...(compiled.description ? { description: compiled.description } : {}),
    source: "custom",
    steps: structuredClone(compiled.steps),
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
  };
}

export function compiledPerformance(
  rootRecipeId: string,
  graph: Readonly<Record<string, Recipe>>,
): AppMapCompiledTest["performance"] {
  const operationCounts: Partial<Record<RecipeStep["kind"], number>> = {};
  let moduleCalls = 0;
  const visit = (recipeId: string, stack: ReadonlySet<string>): void => {
    if (stack.has(recipeId)) return;
    const recipe = graph[recipeId];
    if (!recipe) return;
    const nextStack = new Set(stack).add(recipeId);
    for (const step of recipe.steps) {
      if (step.kind === "module") {
        moduleCalls += 1;
        visit(step.recipeId, nextStack);
        continue;
      }
      operationCounts[step.kind] = (operationCounts[step.kind] ?? 0) + 1;
    }
  };
  visit(rootRecipeId, new Set());
  return {
    executableOperations: Object.values(operationCounts).reduce(
      (total, count) => total + (count ?? 0),
      0,
    ),
    moduleCalls,
    operationCounts,
    screenshotCount: operationCounts.screenshot ?? 0,
    destinationProofCount: operationCounts["expect-screen"] ?? 0,
  };
}
