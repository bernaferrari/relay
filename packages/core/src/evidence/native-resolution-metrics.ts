/**
 * Native resolution metrics (P1): aggregate the activation-transport evidence
 * persisted in `target-resolution` artifacts into per-run facts a caching
 * enablement decision can read.
 *
 * Every number here is descriptive, not a verdict. In particular:
 * - `selectorPointAssisted` counts resolutions whose semantic press carried a
 *   snapshot-derived point contribution. Whether geometry actually actuated
 *   is unknowable from Relay's side — the runner does not report which
 *   transport it used — so these are counted separately from both proven
 *   coordinate actuations and proven pure selector actuations.
 * - `unobservedTransport` counts resolutions with no transport evidence at
 *   all (the press ran outside a target context, or the runner predates the
 *   journal). Absence of evidence is never evidence of a pure selector.
 */
import type {
  ActivationTransport,
  ActivationTransportEvidence,
} from "../device/device-activation-transport.js";
import type { AccessibilityTreeQuality } from "../device/accessibility-tree-quality.js";

export type { NativeResolutionMetrics } from "@relay/protocol";
import type { NativeResolutionMetrics } from "@relay/protocol";

type ArtifactLike = {
  kind: string;
  data?: unknown;
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const TRANSPORTS: ActivationTransport[] = [
  "native-selector",
  "selector-point-assisted",
  "snapshot-point",
  "explicit-point",
  "direct",
];

/** Aggregate the target-resolution artifacts of one run. Artifacts from other
 * kinds are ignored, so a whole run artifact list can be passed directly. */
export function aggregateNativeResolutionMetrics(
  artifacts: readonly ArtifactLike[],
): NativeResolutionMetrics {
  const byMethod: Record<string, number> = {};
  const byTransport: Partial<Record<ActivationTransport | "unobserved", number>> = {};
  let resolutions = 0;
  let pointContributed = 0;
  let coordinateFallbackPermitted = 0;
  let nearMisses = 0;
  let ambiguousNearMisses = 0;
  let collisionRecoveries = 0;
  let treeObserved = 0;
  let treeNodes = 0;
  let treeNamedRatioSum = 0;
  let treeNamedRatioCount = 0;
  let resolutionsWithoutAnyGeometry = 0;

  for (const artifact of artifacts) {
    if (artifact.kind !== "target-resolution") continue;
    const data = objectValue(artifact.data);
    if (!data) continue;
    const method = typeof data.method === "string" ? data.method : undefined;
    if (!method) continue;
    resolutions += 1;
    byMethod[method] = (byMethod[method] ?? 0) + 1;

    const transport = objectValue(data.activationTransport) as
      | (ActivationTransportEvidence & Record<string, unknown>)
      | undefined;
    if (transport && TRANSPORTS.includes(transport.transport)) {
      byTransport[transport.transport] = (byTransport[transport.transport] ?? 0) + 1;
      if (transport.pointContribution === true) pointContributed += 1;
      if (transport.coordinateFallbackPermitted === true) coordinateFallbackPermitted += 1;
      if (transport.collisionRecovery === true) collisionRecoveries += 1;
    } else {
      byTransport.unobserved = (byTransport.unobserved ?? 0) + 1;
    }

    const failures = Array.isArray(data.selectorFailures) ? data.selectorFailures : [];
    if (failures.length > 0) {
      nearMisses += 1;
      if (failures.some((failure) => objectValue(failure)?.status === "ambiguous")) {
        ambiguousNearMisses += 1;
      }
    }

    const quality = objectValue(data.treeQuality) as AccessibilityTreeQuality | undefined;
    if (quality && typeof quality.nodeCount === "number") {
      treeObserved += 1;
      treeNodes += quality.nodeCount;
      if (typeof quality.namedNodeRatio === "number") {
        treeNamedRatioSum += quality.namedNodeRatio;
        treeNamedRatioCount += 1;
      }
      if (quality.geometryNodeCount === 0) resolutionsWithoutAnyGeometry += 1;
    }
  }

  return {
    schemaVersion: 1,
    resolutions,
    byMethod,
    byTransport,
    pointContributed,
    coordinateFallbackPermitted,
    nearMisses,
    ambiguousNearMisses,
    collisionRecoveries,
    treeQuality: {
      observed: treeObserved,
      meanNodeCount: treeObserved > 0 ? treeNodes / treeObserved : 0,
      ...(treeNamedRatioCount > 0
        ? { meanNamedNodeRatio: treeNamedRatioSum / treeNamedRatioCount }
        : {}),
      resolutionsWithoutAnyGeometry,
    },
  };
}
