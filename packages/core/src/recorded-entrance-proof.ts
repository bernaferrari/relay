import type {
  AuthoringObservation,
  RecipeStep,
  RecordedEntrance,
  RecordedEntranceRequest,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { canonicalSha256 } from "./canonical-json.js";
import { nativeCaptureTargetProfile } from "./native-target-profile.js";
import { resolveIosLaunchBundleId } from "./ios-app-launch.js";

export function recordedStepDigest(step: RecipeStep): string {
  const {
    id: _id,
    evidence: _evidence,
    recordedEntrance: _entrance,
    coverage: _coverage,
    group: _group,
    ...execution
  } = step;
  return canonicalSha256(execution);
}
export function requestedNativeTap(step: RecipeStep): RecordedEntranceRequest | undefined {
  if (step.kind !== "tap" || step.target.point || !(step.target.identifier || step.target.label))
    return undefined;
  return {
    identifiers: step.target.identifier ? [step.target.identifier] : [],
    labels: step.target.label ? [step.target.label] : [],
  };
}
export function unavailableRecordedEntrance(entrance: RecordedEntrance): RecordedEntrance {
  const { schemaVersion, takeId, takeRevision, actionId, stepDigest } = entrance;
  return { schemaVersion, takeId, takeRevision, actionId, stepDigest, status: "unavailable" };
}
export function matchesEntranceStep(step: RecipeStep, entrance: RecordedEntrance): boolean {
  return entrance.stepDigest === recordedStepDigest(step);
}
export function currentSelectorEntrance(
  observation: AuthoringObservation,
  targetId: string,
  originApplication: string,
  request: RecordedEntranceRequest,
): boolean {
  const capture = observation.capture;
  const provenance = capture?.selectorEntrance;
  const proof = observation.proof;
  const pixels = proof?.pixels;
  const semanticAt = proof?.semantics.capturedAt;
  if (
    !provenance ||
    !proof ||
    !pixels ||
    proof.captureOrder !== "pixels-ax-pixels" ||
    pixels.status !== "captured" ||
    pixels.bracket?.status !== "coherent" ||
    proof.semantics.status !== "current" ||
    semanticAt === undefined ||
    pixels.capturedAt === undefined ||
    pixels.bracket.afterCapturedAt === undefined ||
    pixels.capturedAt > semanticAt ||
    semanticAt > pixels.bracket.afterCapturedAt ||
    pixels.bracket.afterCapturedAt > observation.capturedAt ||
    capture?.inspectable !== true ||
    capture.snapshotSource !== "sdk" ||
    !capture.treeApp ||
    capture.bindingState === "unavailable" ||
    provenance.profile.targetId !== targetId ||
    canonicalSha256(provenance.request) !== canonicalSha256(request) ||
    observation.bounds?.width !== provenance.profile.viewport.width ||
    observation.bounds?.height !== provenance.profile.viewport.height
  )
    return false;
  try {
    if (resolveIosLaunchBundleId(capture.treeApp) !== resolveIosLaunchBundleId(originApplication))
      return false;
    const profile = provenance.profile;
    return (
      nativeCaptureTargetProfile({
        targetId,
        platform: "ios",
        observedAt: observation.capturedAt,
        viewport: profile.viewport,
        model: profile.model,
        osVersion: profile.osVersion,
      }).id === profile.id
    );
  } catch {
    return false;
  }
}

/** Resolve only an observed Application name or bundle, never a remembered launch target. */
export function observedIosApplication(nodes: readonly SnapshotNode[]): string | undefined {
  const root = nodes.find((node) => node.type === "Application" && node.depth === 0);
  if (!root?.rect || root.logicalCoordinates === false) return undefined;
  for (const value of [root.bundleId, root.identifier, root.label]) {
    if (!value) continue;
    try {
      return resolveIosLaunchBundleId(value);
    } catch {
      /* Try the other observed application fields. */
    }
  }
  return undefined;
}
