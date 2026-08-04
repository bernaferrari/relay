import type { DeviceReadiness } from "./device-readiness";
import type { AppMapRunReadiness } from "./app-map-run-readiness";

export type AppMapPrimaryAction = {
  kind: "run" | "cancel" | "choose-device" | "open-device" | "blocked";
  label: string;
  reason: string;
  icon: "play" | "x" | "smartphone" | "refresh" | "alert";
};

/**
 * Resolve the one action shown at the top-right of an App Map. The button
 * must describe what clicking it will do; a blocked Run button must never
 * secretly open a picker or an unrelated setup screen.
 */
export function appMapPrimaryAction(input: {
  saveState: "idle" | "saving" | "saved" | "invalid";
  run: AppMapRunReadiness;
  serverOnline: boolean;
  device: DeviceReadiness;
  running?: boolean;
}): AppMapPrimaryAction {
  if (input.saveState === "invalid") {
    return {
      kind: "blocked",
      label: "Fix actions",
      reason: "Fix incomplete actions before running this flow",
      icon: "alert",
    };
  }
  if (input.saveState === "saving") {
    return {
      kind: "blocked",
      label: "Saving…",
      reason: "Relay will enable the run when this map is saved",
      icon: "refresh",
    };
  }
  if (input.running) {
    return {
      kind: "cancel",
      label: "Stop run",
      reason: "Stop the current replay",
      icon: "x",
    };
  }
  if (!input.run.ready) {
    return {
      kind: "blocked",
      label: input.run.label,
      reason: input.run.reason,
      icon: "play",
    };
  }
  if (!input.serverOnline) {
    return {
      kind: "blocked",
      label: "Relay offline",
      reason: "Reconnect Relay before running this flow",
      icon: "alert",
    };
  }
  if (input.device.kind === "choose-device") {
    return {
      kind: "choose-device",
      label: "Choose device",
      reason: "Choose where this flow should run",
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
