import type { DeviceInfo } from "./api-types";
import { targetIsReady } from "./target-presentation";

/**
 * A single, product-facing interpretation of a selected target.  Device
 * discovery is inherently asynchronous, but the UI must never turn that into
 * conflicting stories such as "Recording" beside "Loading screen".
 */
export type DeviceReadiness =
  | { kind: "choose-device" }
  | { kind: "device-unavailable"; title: string; detail: string }
  | { kind: "ios-developer-mode-disabled"; title: string; detail: string }
  | { kind: "ios-preparing"; title: string; detail: string }
  | { kind: "screen-preparing"; title: string; detail: string }
  | { kind: "checking-ios"; title: string; detail: string }
  | { kind: "setup-ios"; title: string; detail: string }
  | { kind: "capture-error"; title: string; detail: string }
  | { kind: "ready" };

type AppleSetupSummary = {
  setup: { ios?: unknown };
  checks: Array<{ status: "ready" | "needs-attention"; detail: string }>;
};

export type DeviceReadinessContext = {
  /** `undefined` means this caller does not own Apple setup. `null` means the
   * shared setup request has not resolved yet. */
  appleSetup?: AppleSetupSummary | null;
  liveCaptureIssue?: string | null;
  recordingIssue?: { kind: "setup" | "screen"; message: string } | null;
  requireLiveScreen?: boolean;
  liveScreenAvailable?: boolean;
};

const APPLE_SETUP_ISSUE =
  /(developer mode|runner|signing|xcode|provision|team id|bundle id|set.?up|account)/i;

export function deviceReadiness(
  device: DeviceInfo | null | undefined,
  serverOnline: boolean,
  context: DeviceReadinessContext = {},
): DeviceReadiness {
  if (!device) return { kind: "choose-device" };

  if (!targetIsReady(device, serverOnline)) {
    return {
      kind: "device-unavailable",
      title: `Reconnect ${device.name ?? "device"}`,
      detail: "Relay will be ready once it can reach this device again.",
    };
  }

  if (device.platform === "ios" && device.developerMode === "disabled") {
    return {
      kind: "ios-developer-mode-disabled",
      title: "Turn on Developer Mode",
      detail:
        "On the iPad: Settings → Privacy & Security → Developer Mode. Restart when prompted, then turn it on.",
    };
  }

  if (device.platform === "ios" && device.developerServicesAvailable === false) {
    return {
      kind: "ios-preparing",
      title: "Preparing this iPad",
      detail:
        "Keep the iPad unlocked while macOS enables Apple device support. This can take a minute after Developer Mode is turned on.",
    };
  }

  const captureIssue = context.recordingIssue?.message ?? context.liveCaptureIssue ?? "";
  if (captureIssue) {
    const setupIssue =
      context.recordingIssue?.kind === "setup" || APPLE_SETUP_ISSUE.test(captureIssue);
    return {
      kind: setupIssue ? "setup-ios" : "capture-error",
      title: setupIssue ? "Set up this iPad" : "Can’t read this screen",
      detail: captureIssue,
    };
  }

  // A current frame from this selected device is stronger evidence than a
  // still-pending setup summary. Apple setup and first capture race on cold
  // connections; once pixels arrive, continuing to say "Checking device"
  // contradicts the visible, controllable screen. Recording errors above
  // remain authoritative and are never hidden by an old frame.
  if (context.liveScreenAvailable) return { kind: "ready" };

  if (device.platform === "ios" && context.appleSetup !== undefined) {
    if (context.appleSetup === null) {
      return {
        kind: "checking-ios",
        title: "Checking iPad setup",
        detail: "Relay is checking the local runner before enabling recording.",
      };
    }
    const blockingCheck = context.appleSetup.checks.find(
      (check) => check.status === "needs-attention",
    );
    if (!context.appleSetup.setup.ios || blockingCheck) {
      return {
        kind: "setup-ios",
        title: "Set up this iPad",
        detail:
          blockingCheck?.detail ??
          "Relay needs its local runner before it can read and control this iPad.",
      };
    }
  }

  if (context.requireLiveScreen && !context.liveScreenAvailable) {
    return {
      kind: "screen-preparing",
      title: `Connecting to ${device.name ?? "the device"}`,
      detail: "Keep the device unlocked while Relay waits for its first controllable screen.",
    };
  }

  return { kind: "ready" };
}
