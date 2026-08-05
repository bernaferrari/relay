import type { SnapshotNode } from "./api-types";
import type { PickStrategy } from "./snapshot";
import { presentDeviceIssue, type DeviceReadiness } from "./device-readiness";

type DevicePanelState = {
  kind: "progress" | "recording" | "setup" | "error";
  title: string;
  detail: string;
  primaryAction?: "open-xcode" | "open-settings" | "retry";
  primaryLabel?: string;
  secondaryRetry?: boolean;
};

type CompanionImageLayout = {
  aspectRatio: string;
  widthPercent: number;
  heightPercent: number;
  rotationDegrees: -90 | 0 | 90;
};

/** Abstract device viewport — thin always-dark frame, no hardware gimmicks. */
export const PHONE_SHELL = "phone-bezel relative rounded-[21px] bg-[var(--phone-bezel)] p-px";

export function frameDataUrl(value: { mime: string; base64: string }): string {
  return `data:${value.mime};base64,${value.base64}`;
}

export function strategyLabel(strategy: PickStrategy): string {
  if (strategy.kind === "identifier") return "Stable identifier";
  if (strategy.kind === "ref") return "Element reference";
  if (strategy.kind === "label") return "Accessibility label";
  if (strategy.kind === "text") return "Visible text";
  return "Coordinates";
}

export function strategyValue(strategy: PickStrategy): string {
  if (strategy.kind === "identifier") return strategy.identifier;
  if (strategy.kind === "ref") return strategy.ref;
  if (strategy.kind === "label") return strategy.label;
  if (strategy.kind === "text") return strategy.text;
  return `${strategy.x}, ${strategy.y}`;
}

export function strategyIcon(strategy: PickStrategy): "pointer" | "edit" | "scan" {
  if (strategy.kind === "point") return "scan";
  if (strategy.kind === "ref") return "pointer";
  return "edit";
}

/** Short visible label for the currently-targeted accessibility node. */
export function pickerNodeLabel(node: SnapshotNode | null | undefined): string {
  const visible = (node?.label ?? node?.value ?? node?.identifier ?? "").trim();
  if (visible) return visible;
  const kind = node?.role ?? node?.type?.split(".").pop();
  return kind ? `Unnamed ${kind}` : "Screen position";
}

/** Compact human metadata; implementation references live in strategy rows. */
export function pickerNodeMetaLine(node: SnapshotNode | null | undefined): string {
  if (!node) return "";
  const parts: string[] = [];
  const kind = node.role ?? node.type?.split(".").pop();
  if (kind) parts.push(kind);
  if (node.rect) parts.push(`${Math.round(node.rect.width)}×${Math.round(node.rect.height)}`);
  return parts.join(" · ");
}

export function liveImageStyleFromLayout(layout: CompanionImageLayout | undefined):
  | {
      position: "absolute";
      left: string;
      top: string;
      width: string;
      height: string;
      "max-width": string;
      "transform-origin": string;
      transform: string;
    }
  | undefined {
  if (!layout || layout.rotationDegrees === 0) return undefined;
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: `${layout.widthPercent}%`,
    height: `${layout.heightPercent}%`,
    "max-width": "none",
    "transform-origin": "center",
    transform: `translate(-50%, -50%) rotate(${layout.rotationDegrees}deg)`,
  } as const;
}

/** Map a picker strategy onto the interact-step body the server accepts. */
export function interactBodyForStrategy(
  strategy: PickStrategy,
):
  | { kind: "identifier"; identifier: string }
  | { kind: "ref"; ref: string }
  | { kind: "label"; label: string }
  | { kind: "text-match"; match: string }
  | { kind: "point"; x: number; y: number } {
  if (strategy.kind === "identifier") {
    return { kind: "identifier", identifier: strategy.identifier };
  }
  if (strategy.kind === "ref") return { kind: "ref", ref: strategy.ref };
  if (strategy.kind === "label") return { kind: "label", label: strategy.label };
  if (strategy.kind === "text") return { kind: "text-match", match: strategy.text };
  return { kind: "point", x: strategy.x, y: strategy.y };
}

export type EmptyStageTitleInput = {
  preparing?: boolean;
  targetReady: boolean;
  developerModeDisabled: boolean;
  iosDeviceSupportPending: boolean;
  checkingIosSetup: boolean;
  preparingIosScreen: boolean;
};

export function emptyStageTitle(input: EmptyStageTitleInput): string {
  if (input.preparing) return "Starting live view";
  if (!input.targetReady) return "Device unavailable";
  if (input.developerModeDisabled) return "Turn on Developer Mode";
  if (input.iosDeviceSupportPending) return "Preparing this iPad";
  if (input.checkingIosSetup) return "Checking iPad setup";
  return input.preparingIosScreen ? "Preparing this iPad" : "Waiting for screen";
}

export type StageIosSetupState =
  | "idle"
  | "checking"
  | "preparing"
  | "ready"
  | "needs-setup"
  | "developer-mode-disabled"
  | "failed";

export type DevicePanelStateInput = {
  serverOnline: boolean;
  arming: boolean;
  physicalIosRecording: boolean;
  hasDisplayImage: boolean;
  recordingIssue: { kind: "setup" | "screen"; message: string } | null | undefined;
  liveCaptureIssue: string | null | undefined;
  developerModeDisabled: boolean;
  iosSetupGuidance: string;
  iosDeviceSupportPending: boolean;
  checkingIosSetup: boolean;
  preparingIosScreen: boolean;
  hasIosSetupIssue: boolean;
  deviceName: string | undefined;
  platform: "android" | "ios" | "browser" | undefined;
  openXcodeAvailable: boolean;
  emptyStageTitle: string;
};

export function resolveDevicePanelState(input: DevicePanelStateInput): DevicePanelState | null {
  const issue = input.recordingIssue?.message ?? input.liveCaptureIssue ?? "";
  if (!input.serverOnline) {
    return {
      kind: "error",
      title: "Relay is offline",
      detail: "Reconnect Relay to resume this live device. Your App Map is still safe.",
      primaryAction: "retry",
      primaryLabel: "Reconnect",
    };
  }

  if (input.arming) {
    return {
      kind: "progress",
      title: "Preparing the device",
      detail: "Relay is getting recording and device control ready.",
    };
  }

  // A physical iPad uses one local XCTest runner for video and inspection.
  // While recording, keep the last usable frame if one exists and never
  // replace it with a stale screenshot/setup error caused by a competing
  // read. With no cached frame, explain the direct-device workflow without
  // drawing the message inside a fake phone silhouette.
  if (input.physicalIosRecording) {
    if (input.hasDisplayImage) return null;
    return {
      kind: "recording",
      title: "Recording on this iPad",
      detail: "Use the iPad directly. Relay will refresh the screen when you stop.",
    };
  }

  const accountIssue = /xcode.*not signed in|apple team|accounts settings|valid credentials/i.test(
    issue,
  );

  if (input.developerModeDisabled) {
    return {
      kind: "setup",
      title: "Turn on Developer Mode",
      detail: input.iosSetupGuidance,
      primaryAction: "retry",
      primaryLabel: "Check again",
    };
  }

  // CoreDevice can take a moment to mount its developer image after an iPad
  // is paired or unlocked. During that interval an earlier screenshot poll
  // may still have an error attached to it. Preparation is authoritative:
  // never pair a spinner/header with a stale Retry action.
  if (input.iosDeviceSupportPending || input.checkingIosSetup || input.preparingIosScreen) {
    return {
      kind: "progress",
      title: `Connecting to ${input.deviceName ?? "iPad"}`,
      detail: input.iosSetupGuidance,
    };
  }

  if (input.recordingIssue?.kind === "setup" || input.hasIosSetupIssue) {
    return {
      kind: "setup",
      title: accountIssue ? "Finish setup in Xcode" : "Finish Apple device setup",
      detail:
        (issue ? presentDeviceIssue(issue, input.deviceName ?? "this iPad") : undefined) ||
        "Relay needs a small, locally signed runner before it can read and control this iPad.",
      primaryAction: accountIssue && input.openXcodeAvailable ? "open-xcode" : "open-settings",
      primaryLabel: accountIssue && input.openXcodeAvailable ? "Open Xcode" : "Review setup",
      secondaryRetry: true,
    };
  }

  if (input.recordingIssue || issue) {
    return {
      kind: "error",
      title:
        input.platform === "ios"
          ? `${input.deviceName ?? "iPad"} isn’t ready`
          : "Device isn’t ready",
      detail: presentDeviceIssue(issue, input.deviceName ?? "the device"),
      primaryAction: "retry",
      primaryLabel: "Reconnect",
    };
  }

  // A valid frame is the only state that receives device chrome. Check it
  // after all current failures so stale pixels never hide a newer setup or
  // connection problem inside the old phone-shaped fallback.
  if (input.hasDisplayImage) return null;

  return {
    kind: "progress",
    title:
      input.platform === "ios"
        ? `Connecting to ${input.deviceName ?? "iPad"}`
        : input.emptyStageTitle,
    detail:
      input.platform === "ios"
        ? `Keep ${input.deviceName ?? "the iPad"} unlocked. If iOS asks to enable UI Automation, enter its passcode.`
        : "Relay is waiting for the first screen from this device.",
  };
}

export function iosSetupGuidanceText(input: {
  readiness: DeviceReadiness;
  liveCaptureIssue: string | null | undefined;
  deviceName: string | undefined;
}): string {
  const readiness = input.readiness;
  if (readiness.kind === "ios-developer-mode-disabled") return readiness.detail;
  if (readiness.kind === "ios-preparing") return readiness.detail;
  const issue = input.liveCaptureIssue;
  if (
    issue &&
    /(developer mode|signing|xcode|provision|team id|bundle id|set.?up|account)/i.test(issue)
  )
    return issue;
  return `Keep ${input.deviceName ?? "the iPad"} unlocked. If iOS asks to enable UI Automation, enter its passcode.`;
}

export function hasIosSetupIssueText(input: {
  developerModeDisabled: boolean;
  needsIosSetup: boolean;
  platform: "android" | "ios" | "browser" | undefined;
  liveCaptureIssue: string | null | undefined;
}): boolean {
  const issue = input.liveCaptureIssue ?? "";
  return (
    input.developerModeDisabled ||
    input.needsIosSetup ||
    (input.platform === "ios" &&
      /(signing|xcode|provision|team id|bundle id|set.?up|account)/i.test(issue))
  );
}
