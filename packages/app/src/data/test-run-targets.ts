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
      searching: "Looking for devices and browsers…",
      searchingDetail: "Connected devices and open browsers appear here automatically.",
      none: "No recorded route",
      emptyTitle: "This test has no recorded route",
      emptyDetail: "Record its steps on a device or browser before running.",
    };
  const platform = platforms?.length === 1 ? platforms[0] : undefined;
  if (platform === "android")
    return {
      label: "Android device",
      placeholder: "Choose an Android device",
      searching: "Looking for Android devices…",
      searchingDetail: "Connected phones and running emulators appear here automatically.",
      none: "No Android device found",
      emptyTitle: "Connect an Android device",
      emptyDetail: "Plug in and unlock your phone, or start an emulator.",
    };
  if (platform === "ios")
    return {
      label: "iOS device",
      placeholder: "Choose an iOS device",
      searching: "Looking for iOS devices…",
      searchingDetail: "Connected iPhones, iPads, and booted simulators appear here automatically.",
      none: "No iOS device found",
      emptyTitle: "Connect an iOS device",
      emptyDetail: "Plug in and unlock your iPhone or iPad, or boot a simulator.",
    };
  if (platform === "browser")
    return {
      label: "Browser",
      placeholder: "Choose a browser",
      searching: "Looking for browsers…",
      searchingDetail: "Managed browsers appear here as soon as they’re ready.",
      none: "No browser is ready",
      emptyTitle: "No browser is ready",
      emptyDetail: "Open a managed browser in Devices to run this test.",
    };
  return {
    label: "Device or browser",
    placeholder: "Choose a device or browser",
    searching: "Looking for devices and browsers…",
    searchingDetail: "Connected devices and open browsers appear here automatically.",
    none: "No device or browser found",
    emptyTitle: "No compatible device or browser is ready",
    emptyDetail: "Open Devices to connect a destination for this test.",
  };
}
