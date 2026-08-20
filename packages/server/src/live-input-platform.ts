import { HttpError } from "./http.js";

/**
 * `/device/touch`, `/device/key`, and `/device/scroll` speak scrcpy's
 * Android-only control protocol. Keep this check ahead of the endpoints'
 * fallback logic so an iPad can never enter an Android transport, hide an
 * uncertain XCTest result, and then be sent a second semantic command.
 */
export function assertAndroidLiveInputPlatform(
  platform: "android" | "ios" | "browser" | undefined,
): void {
  if (platform === "android") return;
  if (platform === "ios") {
    throw new HttpError(
      409,
      "Live Android input is unavailable for iOS. Use Relay's canonical interaction action instead.",
    );
  }
  throw new HttpError(409, "Live input requires an attached Android device.");
}
