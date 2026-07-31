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
  | { kind: "ready" };

export function deviceReadiness(
  device: DeviceInfo | null | undefined,
  serverOnline: boolean,
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

  return { kind: "ready" };
}
