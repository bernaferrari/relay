import { createAgentDeviceClient } from "agent-device";
import { captureNativeCrashEvidence } from "../crash-evidence.js";
import type { Device } from "./device-capabilities.js";
import type { DeviceTransport } from "./device-dispatch.js";
import type { TargetContext } from "../target/target-context.js";
import {
  currentTargetContext,
  selectedPlatform,
  targetIdentity,
  targetSessionName,
} from "../target/target-context.js";
import { bindNativeDeviceMutations } from "./device-mutation-adapter.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";
import { targetKey } from "./device-target-applications.js";
import { resetIosSnapshotFlights } from "../ios/ios-snapshot-flight.js";

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

const devicesByTarget = new Map<string, Device>();
/**
 * Local AgentDevice client for the current (or explicit) target.
 * Cloud contexts must use {@link createDeviceForTarget} / CloudDeviceProvider —
 * do not bind a local agent-device session to a remote sessionId.
 */
export function createDevice(explicitContext?: TargetContext): Device {
  const context = explicitContext ?? currentTargetContext();
  if (context.kind === "cloud") {
    throw new Error(
      `createDevice is local-only; use createDeviceForTarget for cloud provider "${context.provider}" (session ${context.sessionId})`,
    );
  }
  const key = targetKey(context);
  let device = devicesByTarget.get(key);
  if (!device) {
    const native = createAgentDeviceClient({
      session: process.env.AGENT_DEVICE_SESSION?.trim() || targetSessionName(context),
    });
    device = buildDeviceTransport(
      native as unknown as Parameters<typeof buildDeviceTransport>[0],
      context,
    );
    devicesByTarget.set(key, device);
  }
  return device;
}

export function resetDeviceClient(context = currentTargetContext()): void {
  devicesByTarget.delete(`${context.platform}:${targetIdentity(context)}`);
  if (context.kind === "device" && context.platform === "ios") {
    // A client reset only happens after an explicit runner/session repair. The
    // old native snapshot cannot be cancelled by agent-device, but that repair
    // has stopped its XCTest session, so it is safe for the next client to
    // begin a fresh tree read.
    resetIosSnapshotFlights(context);
  }
}

/** Drop cached SDK clients after host-level device configuration changes. */
export function resetDeviceClients(): void {
  devicesByTarget.clear();
  resetIosSnapshotFlights();
}
