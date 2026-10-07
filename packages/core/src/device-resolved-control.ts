import {
  pressIdentifier,
  pressLabel,
  pressMatchingText,
  pressPoint,
  type Device,
  type RepeatedPress,
} from "./device.js";
import {
  resolveSnapshotTargetPoint,
  type NamedControlResolution,
  type NamedControlTarget,
} from "./device-target-resolution.js";
import { iosSelectorWasNotDispatched } from "./ios-mutation-policy.js";
import { currentTargetContext, selectedPlatform } from "./target-context.js";
import { snapshotCompleteIosTreeForTargetApplication } from "./ios-runner-listener-command.js";

/** Dispatch a resolved control through its native selector before considering
 * a point. Recording scopes that omit Application geometry must refresh it
 * after a proven selector miss; unknown outcomes never reach that fallback. */
export async function pressResolvedControl(
  device: Device,
  resolution: NamedControlResolution,
  target: NamedControlTarget,
  repeated?: RepeatedPress,
  options: { refreshBeforePointFallbackForApp?: string } = {},
): Promise<NamedControlResolution> {
  // Only resolutions with current-tree evidence that their native selector is
  // untrustworthy opt out. Stable identifiers and labels keep their stronger
  // selector-first behavior.
  if (resolution.method === "label" && target.label?.trim() && target.heading?.trim()) {
    await pressLabel(device, target.label, repeated, target.heading);
    return resolution;
  }
  if (resolution.activation === "snapshot-point") {
    await pressPoint(device, resolution.point.x, resolution.point.y, repeated);
    return resolution;
  }
  if (resolution.method === "identifier" && target.identifier?.trim()) {
    try {
      await pressIdentifier(device, target.identifier, repeated);
    } catch (error) {
      if (!canUseSemanticPointFallback(error)) throw error;
      const point = options.refreshBeforePointFallbackForApp
        ? await freshRecordingFallbackPoint(target, error, options.refreshBeforePointFallbackForApp)
        : resolution.point;
      await pressPoint(device, point.x, point.y, repeated);
    }
    return resolution;
  }
  if (resolution.method === "label" && target.label?.trim()) {
    try {
      await pressLabel(device, target.label, repeated);
    } catch (error) {
      if (!canUseSemanticPointFallback(error)) throw error;
      const point = options.refreshBeforePointFallbackForApp
        ? await freshRecordingFallbackPoint(target, error, options.refreshBeforePointFallbackForApp)
        : resolution.point;
      await pressPoint(device, point.x, point.y, repeated);
    }
    return resolution;
  }
  if (resolution.method === "text" && target.text?.trim()) {
    await pressMatchingText(device, target.text);
    return resolution;
  }
  await pressPoint(device, resolution.point.x, resolution.point.y, repeated);
  return resolution;
}

async function freshRecordingFallbackPoint(
  target: NamedControlTarget,
  error: unknown,
  appBundleId: string,
): Promise<{ x: number; y: number }> {
  const nodes = await snapshotCompleteIosTreeForTargetApplication(
    currentTargetContext(),
    appBundleId,
  );
  const point = resolveSnapshotTargetPoint(nodes, target);
  if (!point) throw error;
  return point;
}

function semanticSelectorDidNotMatch(error: unknown): boolean {
  if (error instanceof Error && error.name === "JobCancelledError") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /\bno match\b|did not match|element not found|selector.*not.*element|(?:native\s+)?(?:label|identifier)(?:\s+selector)?\s+unavailable/i.test(
    message,
  );
}

function canUseSemanticPointFallback(error: unknown): boolean {
  return selectedPlatform() === "ios"
    ? iosSelectorWasNotDispatched(error)
    : semanticSelectorDidNotMatch(error);
}
