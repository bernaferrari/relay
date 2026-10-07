import {
  appMapRuntimeTargetProfileKey,
  IosNativeViewportUnavailableError,
  type NativeDeviceFacts,
  type observeIosNativeViewport,
} from "@relay/core";
import type { AppMapCompiledRuntimeTargetProfile, AuthoringTarget } from "@relay/protocol";
import { explicitTargetAvailability } from "./app-map-run-target-admission.js";
import { HttpError } from "./http.js";

/** A current logical viewport belongs to explicit Run admission. Device
 * inventory remains passive even when its last capture has expired. */
export async function freshNativeRunProfileFacts(input: {
  target: AuthoringTarget;
  profiles: readonly AppMapCompiledRuntimeTargetProfile[];
  observedDevice?: NativeDeviceFacts;
  originApplication?: string;
  validateOffline: () => Promise<void>;
  observeViewport: typeof observeIosNativeViewport;
}): Promise<NativeDeviceFacts | undefined> {
  const { target, observedDevice } = input;
  const matching = new Set(
    input.profiles
      .filter(
        (profile) => profile.targetId === target.targetId && profile.platform === target.platform,
      )
      .map(appMapRuntimeTargetProfileKey),
  );
  if (
    target.kind !== "device" ||
    target.platform !== "ios" ||
    matching.size < 2 ||
    observedDevice?.viewport ||
    observedDevice?.serial !== target.targetId ||
    observedDevice.platform !== target.platform ||
    explicitTargetAvailability(target.targetId, [observedDevice]) !== "connected"
  )
    return observedDevice;
  await input.validateOffline();
  try {
    if (!input.originApplication?.trim())
      throw new IosNativeViewportUnavailableError("origin-unavailable");
    const viewport = await input.observeViewport(target.targetId, input.originApplication);
    if (
      !Number.isSafeInteger(viewport.width) ||
      !Number.isSafeInteger(viewport.height) ||
      viewport.width < 100 ||
      viewport.height < 100
    )
      throw new IosNativeViewportUnavailableError("bounds-unavailable");
    return { ...observedDevice, viewport };
  } catch (error) {
    throw new HttpError(409, "Relay could not check the device’s current screen size", {
      code: "TARGET_VIEWPORT_UNAVAILABLE",
      reason:
        error instanceof IosNativeViewportUnavailableError ? error.reason : "bounds-unavailable",
      recovery:
        "Reconnect the device in Devices, or choose a saved setup in Run settings, then start a new Run.",
    });
  }
}
