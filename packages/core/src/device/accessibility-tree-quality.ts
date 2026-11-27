/**
 * Descriptive quality facts about one accessibility tree.
 *
 * These are measurements, not a health verdict: a sparse tree can be the
 * truth of a simple screen, and a dense tree can still mislead. The native
 * caching enablement decision needs to know whether resolutions were made
 * against rich or thin semantics, so the facts travel with the resolution
 * evidence and aggregate in the resolution metrics. What they deliberately
 * do not claim: that a named-node ratio below any particular number is
 * broken — no such threshold is known today.
 */
import type { SnapshotNode } from "./device-capabilities.js";
import { INTERACTIVE_SNAPSHOT_ROLES } from "./device-target-resolution.js";

export type AccessibilityTreeQuality = {
  nodeCount: number;
  /** Nodes carrying any semantic name a selector could match. */
  namedNodeCount: number;
  /** namedNodeCount / nodeCount; undefined when the tree is empty. */
  namedNodeRatio?: number;
  /** Nodes a tap could plausibly activate: hittable or an interactive role, with geometry. */
  activatableNodeCount: number;
  /** Nodes with positive geometry a coordinate could be derived from. */
  geometryNodeCount: number;
};

function isNamed(node: SnapshotNode): boolean {
  return Boolean(
    node.identifier?.trim() || node.ref?.trim() || node.label?.trim() || node.value?.trim(),
  );
}

function isActivatable(node: SnapshotNode): boolean {
  const role = (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
  if (role === "application" || role === "window") return false;
  if (!node.rect || node.rect.width <= 0 || node.rect.height <= 0) return false;
  return node.hittable === true || INTERACTIVE_SNAPSHOT_ROLES.has(role);
}

export function accessibilityTreeQuality(nodes: readonly SnapshotNode[]): AccessibilityTreeQuality {
  const nodeCount = nodes.length;
  const namedNodeCount = nodes.filter(isNamed).length;
  return {
    nodeCount,
    namedNodeCount,
    ...(nodeCount > 0 ? { namedNodeRatio: namedNodeCount / nodeCount } : {}),
    activatableNodeCount: nodes.filter(isActivatable).length,
    geometryNodeCount: nodes.filter(
      (node) => node.rect !== undefined && node.rect.width > 0 && node.rect.height > 0,
    ).length,
  };
}
