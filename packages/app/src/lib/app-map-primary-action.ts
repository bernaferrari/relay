import type { DeviceReadiness } from "./device-readiness";
import type { AppMapRunReadiness } from "./app-map-run-readiness";

export type AppMapPrimaryAction = {
  kind:
    | "run"
    | "cancel"
    | "choose-device"
    | "open-device"
    | "record-path"
    | "keep-path"
    | "capture-screen"
    | "blocked";
  label: string;
  reason: string;
  icon: "play" | "x" | "smartphone" | "refresh" | "alert" | "circle" | "camera" | "check";
};

/**
 * Resolve the one action shown at the top-right of a map. The button must
 * describe the next real map step — never a disabled Run that secretly opens
 * setup, and never Run when the person still needs to record or keep a path.
 */
export function appMapPrimaryAction(input: {
  saveState: "idle" | "saving" | "saved" | "invalid";
  run: AppMapRunReadiness;
  serverOnline: boolean;
  device: DeviceReadiness;
  liveLocation?: "none" | "unknown" | "here";
  running?: boolean;
}): AppMapPrimaryAction {
  if (input.saveState === "invalid") {
    return {
      kind: "blocked",
      label: "Fix steps",
      reason: "Fix incomplete steps before running this path",
      icon: "alert",
    };
  }
  if (input.saveState === "saving") {
    return {
      kind: "blocked",
      label: "Saving…",
      reason: "Continue once this map finishes saving",
      icon: "refresh",
    };
  }
  if (input.running) {
    return {
      kind: "cancel",
      label: "Stop run",
      reason: "Stop the current run on the device",
      icon: "x",
    };
  }

  if (
    input.device.kind === "ready" &&
    input.liveLocation === "here" &&
    !input.run.ready &&
    input.run.next === "pick"
  ) {
    return {
      kind: "record-path",
      label: "Start recording",
      reason: "Use the device to open the next screen; Relay will add the path to the map.",
      icon: "circle",
    };
  }

  // Map-building steps come before device/run gates so the person always
  // sees the next authoring action when the map is not runnable yet.
  if (!input.run.ready) {
    switch (input.run.next) {
      case "capture":
        return {
          kind: "capture-screen",
          label: input.run.label || "Save first screen",
          reason: input.run.reason,
          icon: "camera",
        };
      case "record":
        return {
          kind: "record-path",
          label:
            input.liveLocation === "here" ? "Start recording" : input.run.label || "Record path",
          reason: input.run.reason,
          icon: "circle",
        };
      case "keep":
        return {
          kind: "keep-path",
          label: input.run.label || "Keep path",
          reason: input.run.reason,
          icon: "check",
        };
      case "pick":
        return {
          kind: "blocked",
          label: input.run.label || "Choose a destination",
          reason: input.run.reason,
          icon: "play",
        };
      case "fix":
        return {
          kind: "blocked",
          label: input.run.label || "Fix path",
          reason: input.run.reason,
          icon: "alert",
        };
      default:
        return {
          kind: "blocked",
          label: input.run.label || "Run path",
          reason: input.run.reason,
          icon: "play",
        };
    }
  }

  if (!input.serverOnline) {
    return {
      kind: "blocked",
      label: "Relay offline",
      reason: "Reconnect Relay before running this path",
      icon: "alert",
    };
  }
  if (input.device.kind === "choose-device") {
    return {
      kind: "choose-device",
      label: "Choose device",
      reason: "Choose a phone, simulator, or browser target to run on",
      icon: "smartphone",
    };
  }
  if (
    input.device.kind === "checking-ios" ||
    input.device.kind === "ios-preparing" ||
    input.device.kind === "screen-preparing"
  ) {
    return {
      kind: "blocked",
      label: "Connecting…",
      reason: input.device.detail,
      icon: "refresh",
    };
  }
  if (input.device.kind !== "ready") {
    return {
      kind: "open-device",
      label:
        input.device.kind === "setup-ios"
          ? "Set up device"
          : input.device.kind === "capture-error" || input.device.kind === "device-unavailable"
            ? "Reconnect device"
            : input.device.title,
      reason: input.device.detail,
      icon:
        input.device.kind === "capture-error" || input.device.kind === "device-unavailable"
          ? "refresh"
          : "smartphone",
    };
  }
  return {
    kind: "run",
    label: input.run.label,
    reason: "",
    icon: "play",
  };
}
