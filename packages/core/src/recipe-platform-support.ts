import type { RecipeStep } from "@relay/protocol";
import { recipeStepPlatformBlocker, type RecipePlatform } from "@relay/protocol";
import { currentTargetContext, type TargetContext } from "./target-context.js";

export { recipeStepPlatformBlocker, type RecipePlatform };

export function recipeExecutionPlatform(context = currentTargetContext()): RecipePlatform {
  return context.kind === "browser" ? "browser" : context.platform;
}

export function compiledGraphPlatformBlocker(
  graph: Record<string, { steps: readonly RecipeStep[] }>,
  platform: RecipePlatform,
): { recipeId: string; reason: string } | undefined {
  for (const [recipeId, recipe] of Object.entries(graph)) {
    for (const step of recipe.steps) {
      const reason = recipeStepPlatformBlocker(step, platform);
      if (reason) return { recipeId, reason };
    }
  }
  return undefined;
}

export function assertRecipeStepPlatformSupport(step: RecipeStep, context?: TargetContext): void {
  const platform = recipeExecutionPlatform(context ?? currentTargetContext());
  const blocker = recipeStepPlatformBlocker(step, platform);
  if (blocker) throw new Error(blocker);
}
