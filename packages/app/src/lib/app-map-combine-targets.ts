import type {
  AppMapCombineCellTargetBinding,
  LocalAgentDeviceExecutionTargetRef,
} from "@relay/protocol";
import {
  EXECUTION_TARGET_REF_VERSION,
  executionTargetRefKey,
  LOCAL_AGENT_DEVICE_PROVIDER_KEY,
  sameAppMapCombineCellValues,
} from "@relay/protocol";
import type { DeviceInfo } from "./api-types";
import { presentTarget, targetIsReady } from "./target-presentation";

export type CombineCellTargetIdentity = Pick<AppMapCombineCellTargetBinding, "testId" | "values">;

/** A visible attached-device choice. Provider sessions deliberately never
 * appear here: Relay has no configured provider capacity to admit today. */
export type LocalCombineTargetOption = {
  target: LocalAgentDeviceExecutionTargetRef;
  label: string;
  detail: string;
  ready: boolean;
};

function localTargetRef(device: DeviceInfo): LocalAgentDeviceExecutionTargetRef | undefined {
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

/** List only locally attached Android/iOS execution lanes. A remote provider
 * cannot be made selectable merely because its name resembles a serial. */
export function localCombineTargetOptions(
  devices: readonly DeviceInfo[],
  online: boolean,
): LocalCombineTargetOption[] {
  return devices
    .flatMap((device) => {
      const target = localTargetRef(device);
      if (!target) return [];
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

export function combineCellTargetBindingFor(
  bindings: readonly AppMapCombineCellTargetBinding[],
  identity: CombineCellTargetIdentity,
): AppMapCombineCellTargetBinding | undefined {
  return bindings.find(
    (binding) =>
      binding.testId === identity.testId &&
      sameAppMapCombineCellValues(binding.values, identity.values),
  );
}

/** A cell can retain an older binding after its device disconnects. Keep that
 * binding visible, but never let it authorize a device-changing action. */
export function isBoundLocalCombineTargetReady(
  binding: AppMapCombineCellTargetBinding | undefined,
  targets: readonly LocalCombineTargetOption[],
): boolean {
  if (!binding) return false;
  const selected = executionTargetRefKey(binding.target);
  return targets.some(
    (target) => target.ready && executionTargetRefKey(target.target) === selected,
  );
}

/** Update one cell only. Target selection never fills neighbours by matching
 * profile, platform, translated text, or the currently selected device. */
export function upsertCombineCellTargetBinding(
  bindings: readonly AppMapCombineCellTargetBinding[],
  identity: CombineCellTargetIdentity,
  target?: LocalAgentDeviceExecutionTargetRef,
): AppMapCombineCellTargetBinding[] {
  const remaining = bindings.filter(
    (binding) =>
      !(
        binding.testId === identity.testId &&
        sameAppMapCombineCellValues(binding.values, identity.values)
      ),
  );
  if (!target) return remaining;
  return [
    ...remaining,
    {
      testId: identity.testId,
      values: { ...identity.values },
      target: structuredClone(target),
    },
  ];
}

/** A scope changes whenever selected rows/tests change. Never send stale
 * target bindings for cells outside the current Combine request. */
export function bindingsForCombineCells<T extends CombineCellTargetIdentity>(
  bindings: readonly AppMapCombineCellTargetBinding[],
  cells: readonly T[],
): AppMapCombineCellTargetBinding[] {
  return cells.flatMap((cell) => {
    const binding = combineCellTargetBindingFor(bindings, cell);
    return binding ? [structuredClone(binding)] : [];
  });
}
