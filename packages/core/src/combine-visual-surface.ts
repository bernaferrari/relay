import type {
  AppMapCapturePolicy,
  AppMapScenarioTest,
  ScrollSurfaceTestBinding,
} from "@relay/protocol";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";

/** Destinations a Test already opted into full-surface coverage. */
export function fullSurfaceBoundScreenIds(
  bindings: readonly ScrollSurfaceTestBinding[] | undefined,
): string[] {
  return [
    ...new Set(
      (bindings ?? [])
        .filter((binding) => binding.captureMode === "full-surface")
        .map((binding) => binding.screenId),
    ),
  ];
}

/**
 * Combine lens `visual` is `every-screen`. That lens plus a destination
 * full-surface binding implies a fresh survey; one viewport is not complete.
 */
export function impliedForceRecaptureSurfaceScreenIds(input: {
  surfaceBindings?: readonly ScrollSurfaceTestBinding[];
  capture?: AppMapCapturePolicy;
}): string[] {
  if (input.capture?.mode !== "every-screen") return [];
  return fullSurfaceBoundScreenIds(input.surfaceBindings);
}

export function compileOptionsForVisualSurface(
  test: Pick<AppMapScenarioTest, "surfaceBindings" | "capture">,
  options: AppMapTestCompileOptions = {},
): AppMapTestCompileOptions {
  const implied = impliedForceRecaptureSurfaceScreenIds(test);
  if (!implied.length) return options;
  return {
    ...options,
    forceRecaptureSurfaceScreenIds: [
      ...new Set([...(options.forceRecaptureSurfaceScreenIds ?? []), ...implied]),
    ],
  };
}
