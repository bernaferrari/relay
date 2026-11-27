import type { RecipeStep } from "@relay/protocol";
import { recipeStepPlatformBlocker, type RecipePlatform } from "@relay/protocol";
import { currentTargetContext, type TargetContext } from "../target/target-context.js";

export { recipeStepPlatformBlocker, type RecipePlatform };
export { compiledGraphPlatformBlocker } from "./recipe-platform-compile.js";

export function recipeExecutionPlatform(context = currentTargetContext()): RecipePlatform {
  return context.kind === "browser" ? "browser" : context.platform;
}

export function assertRecipeStepPlatformSupport(step: RecipeStep, context?: TargetContext): void {
  const platform = recipeExecutionPlatform(context ?? currentTargetContext());
  const blocker = recipeStepPlatformBlocker(step, platform);
  if (blocker) throw new Error(blocker);
}
