import type {
  AppMap,
  AppMapScenarioTest,
  CaptureReviewConfiguration,
  RouteVariantConfigurationQuote,
  TargetProfile,
} from "@relay/protocol";
import {
  captureReviewConfigurationForRoutePlatform,
  listDeclaredRouteVariantConfigurations,
  routeVariantPlatformFromTarget,
  type RouteVariantPlatform,
} from "@relay/protocol";
import {
  resolveNativeRouteCompanions,
  resolveRegisteredAppMapPlatform,
} from "../app-map/app-map-extension-policy.js";
import { frozenRawAccessibilityTargetProfiles } from "../app-map/app-map-test-raw-accessibility.js";

function platformFromOrigin(origin?: string): RouteVariantPlatform | undefined {
  if (origin && /^https?:\/\//iu.test(origin)) return "web";
  return undefined;
}

export function compileRouteVariantPlatform(
  map: AppMap,
  test: AppMapScenarioTest,
  selectedRouteTargetProfile?: TargetProfile,
): RouteVariantPlatform | undefined {
  const fromProfile = routeVariantPlatformFromTarget(selectedRouteTargetProfile?.platform);
  if (fromProfile) return fromProfile;
  const fromOrigin = platformFromOrigin(test.originApplication);
  if (fromOrigin) return fromOrigin;
  const profiles = frozenRawAccessibilityTargetProfiles(map);
  const platforms = new Set(
    profiles.flatMap((profile) => {
      const platform = routeVariantPlatformFromTarget(profile.platform);
      return platform ? [platform] : [];
    }),
  );
  if (platforms.size === 1) return [...platforms][0];
  return resolveRegisteredAppMapPlatform(map);
}

export function compileCaptureReviewConfiguration(
  map: AppMap,
  test: AppMapScenarioTest,
  selectedRouteTargetProfile?: TargetProfile,
): CaptureReviewConfiguration | undefined {
  const platform = compileRouteVariantPlatform(map, test, selectedRouteTargetProfile);
  return platform ? captureReviewConfigurationForRoutePlatform(platform) : undefined;
}

export function compiledRouteVariantConfigurations(
  map: AppMap,
  test: AppMapScenarioTest,
  selectedRouteTargetProfile?: TargetProfile,
): RouteVariantConfigurationQuote[] {
  const members: RouteVariantConfigurationQuote[] = [];
  const platform = compileRouteVariantPlatform(map, test, selectedRouteTargetProfile);
  if (platform) {
    members.push({
      platform,
      configuration: captureReviewConfigurationForRoutePlatform(platform),
      testId: test.id,
      role: "compiled",
    });
  }
  const companions = resolveNativeRouteCompanions(map, test);
  for (const companion of companions) {
    const companionPlatform = companion.platform === "android" ? "android" : "ios";
    members.push({
      platform: companionPlatform,
      configuration: captureReviewConfigurationForRoutePlatform(companionPlatform),
      testId: companion.testId,
      role: "companion",
    });
  }
  return listDeclaredRouteVariantConfigurations(members);
}
