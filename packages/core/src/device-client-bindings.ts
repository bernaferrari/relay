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
 * Session, UDID, and transport are captured in the SDK client's closures
 * (the public methods are arrows). The observation facade applies nested
 * methods on their owning objects; do not recursively `.bind()` into the
 * original client — that mutates shared nested objects and cannot change a
 * closure's captured session.
 */
export function buildDeviceTransport(
  // The raw SDK client shape; kept structural so the vendored version can
  // evolve without this module re-importing it.
  native: ReturnType<typeof createAgentDeviceClient>,
  context: TargetContext,
): Device {
  return createDeviceObservationFacade({
    ...native,
    ...bindNativeDeviceMutations(native, targetIdentity(context), selectedPlatform(context)),
    capture:
      context.kind === "device" && context.platform === "ios"
        ? {
            ...native.capture,
            snapshot: async (...args: Parameters<typeof native.capture.snapshot>) => {
              const result = await native.capture.snapshot(...args);
              // The current Apple runner normalizes both regular and raw frames
              // before presentation. Mark only this SDK boundary, not generic
              // Device adapters that may still report legacy native coordinates.
              return Array.isArray(result.nodes)
                ? {
                    ...result,
                    nodes: result.nodes.map((node) => ({ ...node, logicalCoordinates: true })),
                  }
                : result;
            },
          }
        : native.capture,
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
