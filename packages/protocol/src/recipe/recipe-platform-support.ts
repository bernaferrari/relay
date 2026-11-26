import type { RecipeStep } from "../recipes.js";

export type RecipePlatform = "android" | "ios" | "browser";

/** Compile/runtime blocker for a step that this platform cannot execute. */
export function recipeStepPlatformBlocker(
  step: RecipeStep,
  platform: RecipePlatform,
): string | undefined {
  if (step.kind === "settings" && step.setting === "mobile-data" && platform !== "android") {
    return "settings mobile-data is only supported on Android";
  }
  if (step.kind === "audio-record" && platform !== "browser")
    return "audio-record captures browser HTML media only; native output is unsupported";
  if (step.kind === "offline" && platform !== "browser") {
    return "offline is a browser step";
  }
  if (step.kind === "download" && platform !== "browser") {
    return "download requires a browser target; record a reviewed native file export instead";
  }
  if (step.kind === "upload" && platform === "ios") {
    return "upload on iOS requires a reviewed Files-app handoff; disable this step or record that path";
  }
  if (step.kind === "app" && step.action === "background" && platform === "browser") {
    return "app background is not supported on browser";
  }
  if (step.kind === "settings" && step.setting === "airplane" && platform === "ios") {
    return "airplane on iOS is a Settings handoff, not an in-app airplane control";
  }
  if (step.kind === "device" && (step.action === "lock" || step.action === "unlock")) {
    if (platform === "ios") return "lock-screen control is not supported by this iOS runner";
    if (platform === "browser") return "lock-screen control is not supported on browser";
  }
  return undefined;
}
