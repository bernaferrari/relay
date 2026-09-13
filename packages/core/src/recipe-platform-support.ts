import type { RecipeStep } from "@relay/protocol";
import { currentTargetContext, type TargetContext } from "./target-context.js";

export type RecipePlatform = "android" | "ios" | "browser";

export function recipeExecutionPlatform(context = currentTargetContext()): RecipePlatform {
  return context.kind === "browser" ? "browser" : context.platform;
}

/** Compile/runtime blocker for a step that this platform cannot execute. */
export function recipeStepPlatformBlocker(
  step: RecipeStep,
  platform: RecipePlatform,
): string | undefined {
  if (step.kind === "settings" && step.setting === "mobile-data" && platform !== "android") {
    return "settings mobile-data is only supported on Android";
  }
  if (step.kind === "offline" && platform !== "browser") {
    return "offline is a browser step";
  }
  if (step.kind === "upload" && platform === "ios") {
    return "upload on iOS requires a reviewed Files-app handoff; disable this step or record that path";
  }
  if (step.kind === "app" && step.action === "background" && platform === "browser") {
    return "app background is not supported on browser";
  }
  if (step.kind === "device" && (step.action === "lock" || step.action === "unlock")) {
    if (platform === "ios") return "lock-screen control is not supported by this iOS runner";
    if (platform === "browser") return "lock-screen control is not supported on browser";
  }
  return undefined;
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
