import type { StepTargetRelation } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { isLegacyPositionalBrowserRef } from "./browser-locator-contract.js";

type Rect = { x: number; y: number; width: number; height: number };

export type FollowingRowResolution =
  | { status: "resolved"; point: { x: number; y: number }; bounds: Rect }
  | {
      status: "absent" | "ambiguous" | "unhittable";
      matches: number;
      detail: string;
    };

const INTERACTIVE_ROLES = new Set([
  "button",
  "cell",
  "checkbox",
  "link",
  "securetextfield",
  "slider",
  "switch",
  "textfield",
  "textview",
]);

function usable(node: SnapshotNode): boolean {
  const rect = node.rect;
  if (!rect || rect.width * rect.height < 40 * 24) return false;
  const role = (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
  return role !== "application" && role !== "window";
}

function sameBounds(left: Rect, right: Rect): boolean {
  return (
    Math.abs(left.x - right.x) <= 4 &&
    Math.abs(left.y - right.y) <= 4 &&
    Math.abs(left.width - right.width) <= 4 &&
    Math.abs(left.height - right.height) <= 4
  );
}

function distinctLocations(nodes: SnapshotNode[]): SnapshotNode[] {
  return nodes.filter(
    (candidate, index) =>
      nodes.findIndex((other) => sameBounds(candidate.rect!, other.rect!)) === index,
  );
}

export function relationAnchorMatches(node: SnapshotNode, relation: StepTargetRelation): boolean {
  const target = relation.anchor;
  const roleMatches =
    !target.role ||
    (node.role ?? node.type ?? "").trim().toLocaleLowerCase() ===
      target.role.trim().toLocaleLowerCase();
  if (!roleMatches) return false;
  if (target.identifier && node.identifier === target.identifier) return true;
  if (
    target.ref &&
    !isLegacyPositionalBrowserRef(target.ref) &&
    node.ref?.replace(/^@/u, "") === target.ref.replace(/^@/u, "")
  )
    return true;
  if (target.label) {
    const query = target.label.trim().toLocaleLowerCase();
    const live = node.label?.trim().toLocaleLowerCase();
    if (
      live === query ||
      (live?.startsWith(query) && /^[\s]*[,:;–—([{/-]/u.test(live.slice(query.length)))
    ) {
      return true;
    }
  }
  if (target.text) {
    const query = target.text.trim().toLocaleLowerCase();
    return [node.label, node.value, node.identifier].some((value) =>
      value?.toLocaleLowerCase().includes(query),
    );
  }
  return false;
}

function descendants(nodes: SnapshotNode[], root: SnapshotNode): SnapshotNode[] {
  const result: SnapshotNode[] = [];
  const queue = typeof root.index === "number" ? [root.index] : [];
  while (queue.length > 0) {
    const parentIndex = queue.shift()!;
    for (const node of nodes) {
      if (node.parentIndex !== parentIndex) continue;
      result.push(node);
      if (typeof node.index === "number") queue.push(node.index);
    }
  }
  return result;
}

/** Resolve a stable heading to the value/control row immediately after it.
 * The anchor and row must be siblings, and the next sibling must contain one
 * unique actionable location. No user value or viewport coordinate is used. */
export function resolveFollowingRow(
  nodes: SnapshotNode[],
  relation: StepTargetRelation,
): FollowingRowResolution {
  const anchors = distinctLocations(
    nodes.filter(
      (node) =>
        node.enabled !== false &&
        node.visibleToUser !== false &&
        node.rect !== undefined &&
        relationAnchorMatches(node, relation),
    ),
  );
  if (anchors.length === 0) {
    return {
      status: "absent",
      matches: 0,
      detail: "following-row anchor is not present in the current accessibility tree",
    };
  }
  if (anchors.length !== 1) {
    return {
      status: "ambiguous",
      matches: anchors.length,
      detail: `following-row anchor matches ${anchors.length} different locations`,
    };
  }
  const anchor = anchors[0]!;
  if (typeof anchor.parentIndex !== "number" || typeof anchor.index !== "number") {
    return {
      status: "unhittable",
      matches: 1,
      detail: "following-row anchor has no structural parent",
    };
  }
  const anchorBottom = anchor.rect!.y + anchor.rect!.height;
  const following = nodes
    .filter(
      (node) =>
        node.parentIndex === anchor.parentIndex &&
        node.index !== anchor.index &&
        node.rect !== undefined &&
        node.rect.y >= anchorBottom,
    )
    .sort((left, right) => left.rect!.y - right.rect!.y || (left.index ?? 0) - (right.index ?? 0));
  if (following.length === 0) {
    return {
      status: "absent",
      matches: 0,
      detail: "following-row anchor has no following sibling",
    };
  }
  const nearest = following.filter((node) => Math.abs(node.rect!.y - following[0]!.rect!.y) <= 4);
  const actionable = distinctLocations(
    nearest.flatMap((row) =>
      [row, ...descendants(nodes, row)].filter((node) => {
        const role = (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
        return (
          node.enabled !== false &&
          node.visibleToUser !== false &&
          usable(node) &&
          (node.hittable === true || (node.hittable !== false && INTERACTIVE_ROLES.has(role)))
        );
      }),
    ),
  );
  if (actionable.length === 0) {
    return {
      status: "unhittable",
      matches: nearest.length,
      detail: "the sibling immediately following the anchor has no actionable row",
    };
  }
  const area = Math.max(...actionable.map((node) => node.rect!.width * node.rect!.height));
  const widest = actionable.filter(
    (node) => Math.abs(node.rect!.width * node.rect!.height - area) <= 4,
  );
  if (widest.length !== 1) {
    return {
      status: "ambiguous",
      matches: widest.length,
      detail: `the sibling immediately following the anchor has ${widest.length} actionable locations`,
    };
  }
  const bounds = widest[0]!.rect!;
  return {
    status: "resolved",
    point: {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    },
    bounds,
  };
}
