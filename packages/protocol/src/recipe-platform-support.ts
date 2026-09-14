import type { RecipeStep } from "./recipes.js";

export type RecipePlatform = "android" | "ios" | "browser";

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
