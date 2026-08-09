import type { DeviceInfo } from "./api-types";

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
  /(developer mode|signing|xcode|provision|team id|bundle id|set.?up|account)/i;

/** Turn driver and SDK diagnostics into concise recovery guidance. Raw
 * commands, bundle identifiers, and session names belong in Activity—not in
 * a person-facing canvas state. */
export function presentDeviceIssue(message: string, deviceName = "the device"): string {
  if (/active app session|no active session|session[_ ]not[_ ]found/i.test(message)) {
    return `The app is open, but Relay’s tap session is not attached yet. Retry the tap — or preview first. Keep ${deviceName} unlocked.`;
  }
  if (
    /already in use by session|already bound|another.*session|session.*in use|lease acquisition failed|bound by session/i.test(
      message,
    )
  ) {
    return `Someone else is using ${deviceName}. Press Reconnect — Relay will take it back.`;
  }
  if (
    /artifact restored but runner did not connect|runner did not accept connection|test runner hung before establishing connection/i.test(
      message,
    )
  ) {
    return `Keep ${deviceName} unlocked and enter its passcode if iOS asks to enable UI automation, then try again.`;
  }
  if (/xcode.*not signed in|apple team|accounts settings|valid credentials/i.test(message)) {
    return "Xcode needs access to the Apple account for this iPad. Check Xcode Settings → Accounts, then try again.";
  }
  if (/signing certificate|provision|team id|code sign/i.test(message)) {
    return "Apple signing is incomplete on this Mac. Open Device setup, finish signing, then try again.";
  }
  if (/developer mode/i.test(message)) {
    return "On the iPad: Settings → Privacy & Security → Developer Mode. Restart when prompted, then turn it on.";
  }
  if (/scrcpy|decoder init|adb|emulator-/i.test(message)) {
    return `Relay could not mirror ${deviceName}. Unplug and reconnect the cable, keep the screen on, then try again.`;
  }
  if (/devicectl|not paired|lockdownd|trust this computer/i.test(message)) {
    return `Trust this computer on ${deviceName}, keep it unlocked, then reconnect.`;
  }
  const firstLine = message.split("\n", 1)[0]?.trim() ?? "";
  const withoutCommand = firstLine
    .replace(/\s*Run\s+open\s+first.*$/i, "")
    .replace(/\s*\(for example:.*$/i, "")
    .replace(/\s+owned by human:[0-9a-f-]+/gi, "")
    .replace(/\b(session|lease)\s+[A-Za-z0-9._:-]+/gi, "")
    .replace(/\bhuman:[0-9a-f-]+\b/gi, "")
    .replace(/\bRQ[A-Z0-9]+\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!withoutCommand || /^(session|lease|human:|@e\d+|RQ[A-Z0-9]+)/i.test(withoutCommand)) {
    return `Relay could not read ${deviceName}. Keep it unlocked, then try again.`;
  }
  return withoutCommand;
}

export function deviceReadiness(
  device: DeviceInfo | null | undefined,
  serverOnline: boolean,
  context: DeviceReadinessContext = {},
): DeviceReadiness {
  if (!device) return { kind: "choose-device" };

  // Transport availability takes precedence over stale Apple setup metadata.
  // A disconnected iPad should never be described as merely preparing because
  // its last discovery snapshot happened to lack developer services.
  if (
    !serverOnline ||
    device.booted === false ||
    device.connectionState === "unauthorized" ||
    device.connectionState === "offline"
  ) {
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
        "Keep the iPad unlocked. Relay is finishing the local connection; this can take a minute after Developer Mode is turned on.",
    };
  }

  const captureIssue = context.recordingIssue?.message ?? context.liveCaptureIssue ?? "";
  if (captureIssue) {
    const setupIssue =
      context.recordingIssue?.kind === "setup" || APPLE_SETUP_ISSUE.test(captureIssue);
    return {
      kind: setupIssue ? "setup-ios" : "capture-error",
      title: setupIssue ? "Set up this iPad" : "Can’t read this screen",
      detail: presentDeviceIssue(captureIssue, device.name ?? "the device"),
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
        detail: "Relay is checking that this Mac can read and control the iPad.",
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
          "Relay needs one Apple device permission before it can read and control this iPad.",
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
