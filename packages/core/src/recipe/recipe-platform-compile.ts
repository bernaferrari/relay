import type { RecipeStep } from "@relay/protocol";
import { recipeStepPlatformBlocker, type RecipePlatform } from "@relay/protocol";

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
