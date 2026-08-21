import type {
  AppMapCombineCellTargetBinding,
  LocalAgentDeviceExecutionTargetRef,
} from "@relay/protocol";
import { sameAppMapCombineCellValues } from "@relay/protocol";
import {
  isBoundLocalExecutionTargetReady,
  localExecutionTargetOptions,
  type LocalExecutionTargetOption,
} from "./local-execution-targets";

export type CombineCellTargetIdentity = Pick<AppMapCombineCellTargetBinding, "testId" | "values">;

/** A visible attached-device choice. Provider sessions deliberately never
 * appear here: Relay has no configured provider capacity to admit today. */
export type LocalCombineTargetOption = LocalExecutionTargetOption;

/** Backward-compatible Combine vocabulary for the generic local target list. */
export const localCombineTargetOptions = localExecutionTargetOptions;

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
  return isBoundLocalExecutionTargetReady(
    binding?.target.kind === "local-device" ? binding.target : undefined,
    targets,
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
