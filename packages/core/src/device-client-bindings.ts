import { createAgentDeviceClient } from "agent-device";
import { captureNativeCrashEvidence } from "./crash-evidence.js";
import type { Device } from "./device-capabilities.js";
import type { DeviceTransport } from "./device-dispatch.js";
import type { TargetContext } from "./target-context.js";
import { selectedPlatform, targetIdentity } from "./target-context.js";
import { bindNativeDeviceMutations } from "./device-mutation-adapter.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";

/**
 * Build Relay's canonical Device from a raw agent-device SDK client.
 *
 * agent-device 0.21.x client methods resolve their session and device
 * transport through `this`; a plain `{...native}` spread leaves the copies
 * unbound, which silently degrades to default usbmux routing and loses the
 * session binding (simulators then vanish with "not available through
 * usbmux"). Rebind every method — two levels deep — to its owning object
 * before the observation facade copies them onward.
 */
export function buildDeviceTransport(
  // The raw SDK client shape; kept structural so the vendored version can
  // evolve without this module re-importing it.
  native: ReturnType<typeof createAgentDeviceClient>,
  context: TargetContext,
): Device {
  const rebound = { ...native } as Record<string, unknown>;
  const rebind = (clone: Record<string, unknown>, original: Record<string, unknown>): void => {
    for (const [name, value] of Object.entries(clone)) {
      const originalValue = original[name];
      if (typeof value === "function" && typeof originalValue === "function") {
        clone[name] = (value as (...args: unknown[]) => unknown).bind(original);
      } else if (
        value &&
        typeof value === "object" &&
        originalValue &&
        typeof originalValue === "object"
      ) {
        rebind(value as Record<string, unknown>, originalValue as Record<string, unknown>);
      }
    }
  };
  rebind(rebound, native as unknown as Record<string, unknown>);
  return createDeviceObservationFacade({
    ...rebound,
    ...bindNativeDeviceMutations(native, targetIdentity(context), selectedPlatform(context)),
    observability: {
      ...native.observability,
      crashes: ({ action, since }: { action: "start" | "collect"; since?: number }) =>
        action === "start"
          ? Promise.resolve({
              platform: context.kind === "device" ? context.platform : "android",
              since,
              entries: [],
              truncated: false,
            })
          : captureNativeCrashEvidence(since ?? 0),
    },
  } as unknown as DeviceTransport) as Device;
}
