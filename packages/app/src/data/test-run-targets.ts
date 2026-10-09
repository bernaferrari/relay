import { testRoutePlatformStatuses, type PlanPlatform } from "@relay/product/test-route-platforms";
import type { ProductTestEditorDocument } from "./test-editor-product-service";

/** Destination choices follow the same recorded routes as the platform editor.
 * Undefined preserves discovery for legacy Tests whose platform is not known;
 * an explicit family with no recorded route stays empty. Compile admission
 * remains responsible for any blockers on a recorded route. */
export function recordedTestRunPlatforms(
  document: ProductTestEditorDocument | null | undefined,
  profilePlatform?: PlanPlatform,
): readonly PlanPlatform[] | undefined {
  if (!document) return profilePlatform ? [profilePlatform] : undefined;
  const recordedPlatforms = document.recordedPlatforms?.length
    ? document.recordedPlatforms
    : profilePlatform
      ? [profilePlatform]
      : undefined;
  const statuses = testRoutePlatformStatuses(document.test, { recordedPlatforms });
  const platforms = statuses
    .filter((item) => item.status === "reviewed" || item.status === "blocked")
    .map((item) => item.platform);
  return platforms.length || document.test.family ? platforms : undefined;
}

export function testRunDestinationCopy(platforms?: readonly PlanPlatform[]) {
  if (platforms?.length === 0)
    return {
      label: "Device or browser",
      placeholder: "Choose a device or browser",
      emptyTitle: "This test has no recorded route",
      emptyDetail: "Record its steps on a device or browser before running.",
    };
  const platform = platforms?.length === 1 ? platforms[0] : undefined;
  if (platform === "android")
    return {
      label: "Android device",
      placeholder: "Choose an Android device",
      emptyTitle: "Connect an Android device",
      emptyDetail:
        "Connect and unlock your phone, or start an emulator. Relay will find it automatically.",
    };
  if (platform === "ios")
    return {
      label: "iOS device",
      placeholder: "Choose an iOS device",
      emptyTitle: "Connect an iOS device",
      emptyDetail: "Connect and unlock your device. Relay will find it automatically.",
    };
  if (platform === "browser")
    return {
      label: "Browser",
      placeholder: "Choose a browser",
      emptyTitle: "No browser is ready",
      emptyDetail: "Open a managed browser in Devices to run this test.",
    };
  return {
    label: "Device or browser",
    placeholder: "Choose a device or browser",
    emptyTitle: "No compatible device or browser is ready",
    emptyDetail: "Open Devices to connect a destination for this test.",
  };
}
