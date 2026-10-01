import type { AuthoringObservation } from "@relay/protocol";
import { hasCurrentAuthoringSemantics } from "../authoring-observation-proof.js";
import { observeScreenIdentity } from "../screen-identity.js";
import type { SnapshotNode } from "../device.js";
import type { AppMap, Screen } from "./model.js";

/** Reuse a unique, exact application structure when only input focus or system keyboard state changed. */
export function equivalentScreenCapture(
  map: AppMap,
  observation?: AuthoringObservation,
): Screen | undefined {
  if (!hasCurrentAuthoringSemantics(observation?.proof) || !observation?.nodes?.length)
    return undefined;
  const normalize = (nodes: readonly SnapshotNode[]) =>
    observeScreenIdentity(nodes.slice(0, 256).map(({ focused: _focused, ...node }) => node));
  const current = normalize(observation.nodes as SnapshotNode[]);
  // Shared app roots and sparse or unavailable trees cannot prove equivalence.
  if (current.nodes.length < 5) return undefined;
  const matches = Object.values(map.screens).filter((screen) =>
    screen.variantIds.some((id) => {
      const nodes = map.screenVariants[id]?.observation?.nodes;
      if (!nodes?.length) return false;
      const saved = normalize(nodes as SnapshotNode[]);
      return saved.nodes.length >= 5 && saved.fingerprint === current.fingerprint;
    }),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
