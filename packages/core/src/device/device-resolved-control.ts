import {
  pressIdentifier,
  pressLabel,
  pressMatchingText,
  pressPoint,
  snapshot,
  type Device,
  type RepeatedPress,
  type SnapshotNode,
} from "./device.js";
import {
  activationTransportEvidenceSince,
  activationTransportSequence,
} from "./device-activation-transport.js";
import { explicitPointResolution, resolveNamedControl } from "./device-target-resolution.js";
import { NamedControlMissError } from "./named-control-miss.js";
import { namedControlObservationOptions } from "./named-control-observation.js";
import {
  identifierNodesViaLiveIosRunnerListener,
  labelNodesViaLiveIosRunnerListener,
} from "../ios/ios-runner-listener-command.js";
import { rememberedTargetApplication } from "./device-target-applications.js";
import {
  resolveSnapshotTargetPoint,
  type NamedControlResolution,
  type NamedControlTarget,
} from "./device-target-resolution.js";
import { iosSelectorWasNotDispatched } from "../ios/ios-mutation-policy.js";
import { currentTargetContext, selectedPlatform } from "../target/target-context.js";
import { snapshotCompleteIosTreeForTargetApplication } from "../ios/ios-runner-listener-command.js";

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
  // The press paths below journal every actuation they dispatch. Diffing the
  // journal across the whole decision — including any selector miss that fell
  // through to coordinates — produces this resolution's transport evidence.
  const sequence = activationTransportSequence();
  const pressed = await dispatchResolvedControl(device, resolution, target, repeated, options);
  const activationTransport = activationTransportEvidenceSince(sequence);
  return activationTransport ? { ...pressed, activationTransport } : pressed;
}

async function dispatchResolvedControl(
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
    await pressPoint(device, resolution.point.x, resolution.point.y, repeated, {
      provenance: "snapshot-point",
      resolutionMethod: resolution.method,
    });
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
      await pressPoint(device, point.x, point.y, repeated, {
        provenance: "snapshot-point",
        resolutionMethod: "identifier",
      });
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
      await pressPoint(device, point.x, point.y, repeated, {
        provenance: "snapshot-point",
        resolutionMethod: "label",
      });
    }
    return resolution;
  }
  if (resolution.method === "text" && target.text?.trim()) {
    await pressMatchingText(device, target.text);
    return resolution;
  }
  await pressPoint(device, resolution.point.x, resolution.point.y, repeated, {
    provenance: resolution.method === "point" ? "explicit-point" : "snapshot-point",
    resolutionMethod: resolution.method,
  });
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

export function androidNamedPressCompletedHandoff(
  error: unknown,
  target: NamedControlTarget,
): boolean {
  if (selectedPlatform() !== "android") return false;
  if (!target.identifier?.trim() && !target.label?.trim() && !target.text?.trim()) return false;
  const message = error instanceof Error ? error.message : String(error);
  const handoff = /press coordinate tap left\s+(\S+)\s+and foregrounded\s+(\S+)/i.exec(message);
  const destination = handoff?.[2]?.replace(/[.,;:]+$/, "");
  if (!destination || destination === handoff?.[1]) return false;
  return Boolean(target.expectedApp?.trim() && destination === target.expectedApp.trim());
}

/** Snapshot → resolveNamedControl → press. Used by recipe taps, mouse interact, and CLI. */
export async function pressNamedControl(
  device: Device,
  target: NamedControlTarget,
  repeated?: RepeatedPress,
): Promise<NamedControlResolution> {
  const pointOnly = explicitPointResolution(target.point);
  const hasNamed = Boolean(
    target.identifier?.trim() || target.label?.trim() || target.text?.trim(),
  );
  if (pointOnly && !hasNamed) {
    const sequence = activationTransportSequence();
    await pressPoint(device, pointOnly.point.x, pointOnly.point.y, repeated);
    const activationTransport = activationTransportEvidenceSince(sequence);
    return activationTransport ? { ...pointOnly, activationTransport } : pointOnly;
  }
  let nodes: SnapshotNode[];
  try {
    nodes = await snapshot(device, namedControlObservationOptions(target, selectedPlatform()));
  } catch (error) {
    if (pointOnly) {
      await pressPoint(device, pointOnly.point.x, pointOnly.point.y, repeated);
      return pointOnly;
    }
    throw error;
  }
  if (!nodes.length && pointOnly) {
    await pressPoint(device, pointOnly.point.x, pointOnly.point.y, repeated);
    return pointOnly;
  }
  let resolved = resolveNamedControl(nodes, target);
  // A fresh proof context (fixture lanes mint one per operation) can serve
  // its accessibility tree a beat after the page is interactive. A first
  // grounding miss on a browser is therefore retried briefly before it is
  // declared final — the tap must not silently no-op on a page that merely
  // was not semantic-ready yet.
  const context = currentTargetContext();
  const browserGroundingRetry = context.kind === "browser";
  const groundingDeadline = performance.now() + 3_000;
  while (!resolved && browserGroundingRetry && performance.now() < groundingDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    nodes = await snapshot(device, {
      ...(target.identifier?.trim() ? { includeIdentifiers: [target.identifier] } : {}),
      ...(target.label?.trim() ? { includeLabels: [target.label] } : {}),
    });
    resolved = resolveNamedControl(nodes, target);
  }
  if (!resolved && target.identifier?.trim() && selectedPlatform() === "ios") {
    try {
      const iosContext = currentTargetContext();
      if (iosContext.kind === "device" && iosContext.platform === "ios") {
        const extra = await identifierNodesViaLiveIosRunnerListener({
          serial: iosContext.serial,
          identifier: target.identifier,
          appBundleId: await rememberedTargetApplication(iosContext),
        });
        if (extra?.length) resolved = resolveNamedControl(extra, { identifier: target.identifier });
      }
    } catch {
      // Keep the chrome-bounded miss. Do not invent a point.
    }
  }
  if (!resolved && target.label?.trim() && selectedPlatform() === "ios") {
    try {
      const iosContext = currentTargetContext();
      if (iosContext.kind === "device" && iosContext.platform === "ios") {
        const extra = await labelNodesViaLiveIosRunnerListener({
          serial: iosContext.serial,
          label: target.label,
          appBundleId: await rememberedTargetApplication(iosContext),
        });
        if (extra?.length) resolved = resolveNamedControl(extra, { label: target.label });
      }
    } catch {
      // Keep the chrome-bounded miss. Do not invent a point.
    }
  }
  if (!resolved) throw new NamedControlMissError(nodes, target);
  try {
    return await pressResolvedControl(device, resolved, target, repeated);
  } catch (error) {
    if (androidNamedPressCompletedHandoff(error, target)) return resolved;
    throw error;
  }
}
