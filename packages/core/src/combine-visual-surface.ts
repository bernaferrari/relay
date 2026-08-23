import type {
  AppMap,
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

/** Bind a destination that already has a frozen full-surface capture. */
export function fullSurfaceBindingForScreen(
  map: Pick<AppMap, "screens" | "screenVariants">,
  screenId: string,
): ScrollSurfaceTestBinding | undefined {
  const screen = map.screens[screenId];
  if (!screen) return undefined;
  for (const variantId of screen.variantIds ?? []) {
    const variant = map.screenVariants[variantId];
    const surface = variant?.scrollSurfaces
      ?.slice()
      .reverse()
      .find((candidate) => candidate.capturePolicy.captureMode === "full-surface");
    if (!variant || !surface) continue;
    return {
      screenId,
      variantId: variant.id,
      captureMode: "full-surface",
      reason: "Capture the full scrolling screen.",
      surfaceId: surface.id,
      baselineCaptureId: surface.captureId,
      compare: "visual-and-semantic",
      repair: "propose-recapture",
    };
  }
  return undefined;
}

/** Run-scoped overlay so Combine visual can survey named destinations. */
export function applyFullSurfaceDestinationBindings(
  map: AppMap,
  testIds: readonly string[],
  screenIds: readonly string[],
): AppMap {
  const destinations = [...new Set(screenIds.map((id) => id.trim()).filter(Boolean))];
  if (!destinations.length) return map;
  const tests = { ...map.tests };
  let changed = false;
  for (const testId of testIds) {
    const test = tests[testId];
    if (!test) continue;
    const bindings = [...(test.surfaceBindings ?? [])];
    const seen = new Set(
      bindings
        .filter((binding) => binding.captureMode === "full-surface")
        .map((binding) => binding.screenId),
    );
    let appended = false;
    for (const screenId of destinations) {
      if (seen.has(screenId)) continue;
      const binding = fullSurfaceBindingForScreen(map, screenId);
      if (!binding) continue;
      bindings.push(binding);
      seen.add(screenId);
      appended = true;
    }
    if (!appended) continue;
    tests[testId] = { ...test, surfaceBindings: bindings };
    changed = true;
  }
  return changed ? { ...map, tests } : map;
}
