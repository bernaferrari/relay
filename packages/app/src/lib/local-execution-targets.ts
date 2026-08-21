import type { LocalAgentDeviceExecutionTargetRef } from "@relay/protocol";
import {
  EXECUTION_TARGET_REF_VERSION,
  executionTargetRefKey,
  LOCAL_AGENT_DEVICE_PROVIDER_KEY,
} from "@relay/protocol";
import type { DeviceInfo } from "./api-types";
import { presentTarget, targetIsReady } from "./target-presentation";

/** A visible attached-device choice. Provider sessions deliberately never
 * appear here: Relay has no configured provider capacity to admit today. */
export type LocalExecutionTargetOption = {
  target: LocalAgentDeviceExecutionTargetRef;
  label: string;
  detail: string;
  ready: boolean;
};

/** Make only coherent local Android/iOS refs. A selected browser or a string
 * that merely resembles a provider target can never enter local admission. */
export function localExecutionTargetFor(
  device: DeviceInfo,
): LocalAgentDeviceExecutionTargetRef | undefined {
  if (device.platform !== "android" && device.platform !== "ios") return undefined;
  const targetId = device.serial.trim();
  if (!targetId) return undefined;
  return {
    schemaVersion: EXECUTION_TARGET_REF_VERSION,
    kind: "local-device",
    provider: { key: LOCAL_AGENT_DEVICE_PROVIDER_KEY, scope: "local" },
    targetId,
    platform: device.platform,
    identity: { kind: "device-serial", value: targetId },
  };
}

/** List only local Android/iOS lanes; readiness is display state, never a
 * substitute for the immutable target reference kept on the binding. */
export function localExecutionTargetOptions(
  devices: readonly DeviceInfo[],
  online: boolean,
  requiredPlatform?: LocalAgentDeviceExecutionTargetRef["platform"],
): LocalExecutionTargetOption[] {
  return devices
    .flatMap((device) => {
      const target = localExecutionTargetFor(device);
      if (!target || (requiredPlatform && target.platform !== requiredPlatform)) return [];
      const presented = presentTarget(device);
      return [
        {
          target,
          label: `${presented.displayName} · ${presented.platformLabel}`,
          detail: `${presented.statusLabel} · ${target.targetId}`,
          ready: targetIsReady(device, online),
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(right.ready) - Number(left.ready) ||
        left.label.localeCompare(right.label) ||
        left.target.targetId.localeCompare(right.target.targetId),
    );
}

/** An old target remains visible on a case, but only a currently ready local
 * lane can authorize an evidence read or deadline preflight. */
export function isBoundLocalExecutionTargetReady(
  target: LocalAgentDeviceExecutionTargetRef | undefined,
  options: readonly LocalExecutionTargetOption[],
): boolean {
  if (!target) return false;
  const key = executionTargetRefKey(target);
  return options.some((option) => option.ready && executionTargetRefKey(option.target) === key);
}
