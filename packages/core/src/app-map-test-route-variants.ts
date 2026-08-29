import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTestRouteVariant,
  AppMapTestViewportClass,
  TargetProfile,
} from "@relay/protocol";
import {
  appMapRuntimeTargetProfileFromSaved,
  sameAppMapRuntimeTargetProfile,
} from "./app-map-runtime-target-profile.js";

export type AppMapTestRouteSelectionErrorCode =
  | "target-surface-required"
  | "target-profile-ambiguous"
  | "route-variant-not-found"
  | "route-variant-ambiguous";

export class AppMapTestRouteSelectionError extends Error {
  constructor(
    readonly code: AppMapTestRouteSelectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppMapTestRouteSelectionError";
  }
}

export function appMapTestViewportClass(
  viewport: { width: number; height: number } | undefined,
): AppMapTestViewportClass | undefined {
  if (!viewport) return undefined;
  if (viewport.width < 600) return "compact";
  if (viewport.width < 1_024) return "medium";
  return "expanded";
}

function targetProfileSelectionKey(profile: TargetProfile): string {
  const viewport = profile.browserCaseProfile?.viewport ?? profile.viewport;
  return JSON.stringify({
    id: profile.id,
    targetId: profile.targetId,
    platform: profile.platform,
    viewport,
    browserEngine: profile.browserCaseProfile?.engine,
    browserCaseProfile: profile.browserCaseProfile,
    capabilities: [...profile.capabilities].sort(),
  });
}

/** Recover the complete saved target facts corresponding to the immutable
 * runtime identity. Conflicting copies fail rather than lending one surface
 * another surface's capabilities or browser engine. */
export function savedTestRouteTargetProfile(
  map: AppMap,
  runtime: AppMapCompiledRuntimeTargetProfile,
): TargetProfile {
  const profiles = Object.values(map.screenVariants)
    .map((variant) => variant.targetProfile)
    .filter(
      (profile) =>
        profile.id === runtime.id &&
        profile.targetId === runtime.targetId &&
        profile.platform === runtime.platform &&
        sameAppMapRuntimeTargetProfile(appMapRuntimeTargetProfileFromSaved(profile), runtime),
    );
  if (!profiles.length) {
    throw new AppMapTestRouteSelectionError(
      "target-surface-required",
      `Saved target profile ${runtime.id} is unavailable for route selection`,
    );
  }
  if (new Set(profiles.map(targetProfileSelectionKey)).size !== 1) {
    throw new AppMapTestRouteSelectionError(
      "target-profile-ambiguous",
      `Saved target profile ${runtime.id} has conflicting route-selection facts`,
    );
  }
  return structuredClone(profiles[0]!);
}

function matches(variant: AppMapTestRouteVariant, profile: TargetProfile): boolean {
  const predicate = variant.predicate;
  const viewport = profile.browserCaseProfile?.viewport ?? profile.viewport;
  const viewportClass = appMapTestViewportClass(viewport);
  return (
    (!predicate.platforms || predicate.platforms.includes(profile.platform)) &&
    (!predicate.browserEngines ||
      (profile.browserCaseProfile !== undefined &&
        predicate.browserEngines.includes(profile.browserCaseProfile.engine))) &&
    (!predicate.viewportClasses ||
      (viewportClass !== undefined && predicate.viewportClasses.includes(viewportClass))) &&
    (!predicate.requiredCapabilities ||
      predicate.requiredCapabilities.every((capability) =>
        profile.capabilities.includes(capability),
      ))
  );
}

/** Select a whole reviewed implementation once. Per-step selection is
 * deliberately impossible, preventing a compiled route from mixing surfaces. */
export function selectReviewedTestRouteVariant(
  test: AppMapScenarioTest,
  profile: TargetProfile | undefined,
): AppMapTestRouteVariant | undefined {
  if (!test.family) return undefined;
  if (!profile) {
    throw new AppMapTestRouteSelectionError(
      "target-surface-required",
      `Test ${test.name} needs a saved target profile before route selection`,
    );
  }
  const matchesForProfile = test.family.routeVariants.filter((variant) =>
    matches(variant, profile),
  );
  if (matchesForProfile.length === 0) {
    throw new AppMapTestRouteSelectionError(
      "route-variant-not-found",
      `Test ${test.name} has no reviewed route for target profile ${profile.id}`,
    );
  }
  if (matchesForProfile.length > 1) {
    throw new AppMapTestRouteSelectionError(
      "route-variant-ambiguous",
      `Test ${test.name} has multiple reviewed routes for target profile ${profile.id}: ${matchesForProfile
        .map((variant) => variant.id)
        .sort()
        .join(", ")}`,
    );
  }
  return structuredClone(matchesForProfile[0]!);
}

function applyBindings(
  steps: AppMapScenarioTestStep[],
  bindings: AppMapTestRouteVariant["bindings"],
  consumed: Set<string>,
): AppMapScenarioTestStep[] {
  return steps.map((step) => {
    const binding = bindings[step.id];
    if (binding) consumed.add(step.id);
    const selected = binding ? { ...step, binding: structuredClone(binding) } : { ...step };
    if (selected.kind === "decision") {
      return {
        ...selected,
        thenSteps: applyBindings(selected.thenSteps, bindings, consumed),
        ...(selected.elseSteps
          ? { elseSteps: applyBindings(selected.elseSteps, bindings, consumed) }
          : {}),
      };
    }
    if (selected.kind === "loop") {
      return { ...selected, steps: applyBindings(selected.steps, bindings, consumed) };
    }
    return selected;
  }) as AppMapScenarioTestStep[];
}

export function testWithSelectedRouteVariant(
  test: AppMapScenarioTest,
  variant: AppMapTestRouteVariant | undefined,
): AppMapScenarioTest {
  if (!variant) return structuredClone(test);
  const consumed = new Set<string>();
  const selected = {
    ...structuredClone(test),
    steps: applyBindings(test.steps, variant.bindings, consumed),
  };
  const missing = Object.keys(variant.bindings).filter((stepId) => !consumed.has(stepId));
  if (missing.length) {
    throw new AppMapTestRouteSelectionError(
      "route-variant-not-found",
      `Route variant ${variant.id} references missing Test steps: ${missing.sort().join(", ")}`,
    );
  }
  return selected;
}
