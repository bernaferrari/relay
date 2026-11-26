import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  AppMapScenarioTest,
  AppMapTestRouteVariant,
  TargetProfile,
} from "@relay/protocol";
import { AppMapTestCompileError } from "./app-map-test-compile-error.js";
import {
  AppMapTestRouteSelectionError,
  disableScenarioTestForUnrecordedRoute,
  isUnrecordedRuntimePlatform,
  savedTestRouteTargetProfile,
  selectReviewedTestRouteVariant,
} from "./app-map-test-route-variants.js";

export function resolveScenarioTestCompileRoute(
  map: AppMap,
  authoredTest: AppMapScenarioTest,
  runtimeTargetProfile?: AppMapCompiledRuntimeTargetProfile,
): {
  test: AppMapScenarioTest;
  selectedRouteTargetProfile?: TargetProfile;
  selectedRouteVariant: AppMapTestRouteVariant | undefined;
} {
  const platform = runtimeTargetProfile?.platform;
  if (isUnrecordedRuntimePlatform(map, authoredTest, platform)) {
    return {
      test: disableScenarioTestForUnrecordedRoute(authoredTest, platform),
      selectedRouteTargetProfile: undefined,
      selectedRouteVariant: undefined,
    };
  }
  try {
    const selectedRouteTargetProfile = runtimeTargetProfile
      ? savedTestRouteTargetProfile(map, runtimeTargetProfile)
      : undefined;
    const selectedRouteVariant = selectReviewedTestRouteVariant(
      authoredTest,
      selectedRouteTargetProfile,
    );
    if (
      selectedRouteTargetProfile &&
      !selectedRouteVariant &&
      isUnrecordedRuntimePlatform(map, authoredTest, selectedRouteTargetProfile.platform)
    ) {
      return {
        test: disableScenarioTestForUnrecordedRoute(
          authoredTest,
          selectedRouteTargetProfile.platform,
        ),
        selectedRouteTargetProfile: undefined,
        selectedRouteVariant: undefined,
      };
    }
    return { test: authoredTest, selectedRouteTargetProfile, selectedRouteVariant };
  } catch (error) {
    if (error instanceof AppMapTestRouteSelectionError) {
      if (isUnrecordedRuntimePlatform(map, authoredTest, platform)) {
        return {
          test: disableScenarioTestForUnrecordedRoute(authoredTest, platform),
          selectedRouteTargetProfile: undefined,
          selectedRouteVariant: undefined,
        };
      }
      throw new AppMapTestCompileError(
        error.code,
        authoredTest.id,
        authoredTest.steps[0]?.id ?? authoredTest.id,
        error.message,
      );
    }
    throw error;
  }
}
