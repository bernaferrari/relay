/**
 * Focus a text field before typing into it.
 *
 * Composite composers (Compose, SwiftUI) expose one editable node whose bounds
 * also hold attach, model, dictation, and send buttons. Tapping the centre of
 * that node can open a chip or a drawer instead of placing the caret, so focus
 * lands on a point inside the editable that no nested control claims.
 */
import type { SnapshotNode } from "./device-capabilities.js";
import {
  resolveNamedControlOutcome,
  type NamedControlResolution,
} from "./device-target-resolution.js";
import { GroundingError } from "./grounding.js";

export type TextEntryTarget = {
  identifier?: string;
  ref?: string;
  label?: string;
  text?: string;
  point?: { x: number; y: number };
};

type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

export type TextEntryFocusPlan = {
  resolution: NamedControlResolution;
  field?: SnapshotNode;
  /** The field already owns input focus, so no tap is needed. */
  alreadyFocused: boolean;
};

const EDITABLE_TYPE =
  /EditText|TextField|SecureTextField|SearchField|TextView.*Editable|textbox|searchbox|combobox/i;

export function isEditableNode(node: SnapshotNode): boolean {
  return node.editable === true || EDITABLE_TYPE.test(`${node.type ?? ""} ${node.role ?? ""}`);
}

function area(rect: Rect): number {
  return rect.width * rect.height;
}

function containsPoint(rect: Rect, point: Point, pad = 0): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  );
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function sameRect(a: Rect | undefined, b: Rect): boolean {
  return Boolean(a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

function ancestorIndexes(nodes: SnapshotNode[], node: SnapshotNode): Set<number> {
  const byIndex = new Map(
    nodes.flatMap((item) => (item.index === undefined ? [] : [[item.index, item] as const])),
  );
  const ancestors = new Set<number>();
  let parent = node.parentIndex;
  while (parent !== undefined && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = byIndex.get(parent)?.parentIndex;
  }
  return ancestors;
}

function isDescendantOf(
  nodes: SnapshotNode[],
  node: SnapshotNode,
  ancestor: SnapshotNode,
): boolean {
  return ancestor.index !== undefined && ancestorIndexes(nodes, node).has(ancestor.index);
}

/** The editable that owns a resolved selector: itself, an ancestor, a child, or the field under the point. */
export function resolveTextEntryField(
  nodes: SnapshotNode[],
  matched: SnapshotNode | undefined,
  point: Point,
): SnapshotNode | undefined {
  if (matched && isEditableNode(matched)) return matched;
  if (matched) {
    const ancestors = ancestorIndexes(nodes, matched);
    const ancestor = nodes
      .filter(
        (node) => node.index !== undefined && ancestors.has(node.index) && isEditableNode(node),
      )
      .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0))[0];
    if (ancestor) return ancestor;
    const descendant = nodes
      .filter((node) => node.rect && isEditableNode(node) && isDescendantOf(nodes, node, matched))
      .sort((a, b) => area(b.rect!) - area(a.rect!))[0];
    if (descendant) return descendant;
  }
  return nodes
    .filter((node) => node.rect && node.visibleToUser !== false && isEditableNode(node))
    .filter((node) => containsPoint(node.rect!, point))
    .sort((a, b) => area(a.rect!) - area(b.rect!))[0];
}

/**
 * A caret point inside the field that no nested or overlapping control owns.
 * Visible hint/value text is the text line; otherwise scan the field from the
 * top, where composers keep their text above the action row.
 */
export function textEntryFocusPoint(nodes: SnapshotNode[], field: SnapshotNode): Point | undefined {
  const rect = field.rect;
  if (!rect) return undefined;
  const ancestors = field.index === undefined ? new Set<number>() : ancestorIndexes(nodes, field);
  const blockers = nodes
    .filter(
      (node) =>
        node !== field &&
        node.rect &&
        node.hittable === true &&
        node.visibleToUser !== false &&
        !(node.index !== undefined && ancestors.has(node.index)) &&
        area(node.rect) < area(rect) &&
        intersects(node.rect, rect),
    )
    .map((node) => node.rect!);
  const inside = (point: Point) =>
    containsPoint(
      { x: rect.x + 4, y: rect.y + 4, width: rect.width - 8, height: rect.height - 8 },
      point,
    );
  const free = (point: Point) =>
    inside(point) && !blockers.some((blocker) => containsPoint(blocker, point, 6));
  const textLines = nodes
    .filter(
      (node) =>
        node !== field &&
        node.rect &&
        node.hittable !== true &&
        Boolean(node.label?.trim() || node.value?.trim()) &&
        isDescendantOf(nodes, node, field),
    )
    .sort((a, b) => a.rect!.y - b.rect!.y)
    .map((node) => ({
      x: Math.round(node.rect!.x + node.rect!.width / 2),
      y: Math.round(node.rect!.y + node.rect!.height / 2),
    }));
  const grid = [0.2, 0.35, 0.5, 0.12, 0.65, 0.8].flatMap((fy) =>
    [0.5, 0.3, 0.7, 0.15, 0.85].map((fx) => ({
      x: Math.round(rect.x + rect.width * fx),
      y: Math.round(rect.y + rect.height * fy),
    })),
  );
  return [...textLines, ...grid].find(free);
}

function matchedNode(
  nodes: SnapshotNode[],
  resolution: NamedControlResolution,
): SnapshotNode | undefined {
  return (
    nodes.find((node) => sameRect(node.rect, resolution.bounds)) ??
    nodes
      .filter((node) => node.rect && containsPoint(node.rect, resolution.point))
      .sort((a, b) => area(a.rect!) - area(b.rect!))[0]
  );
}

function describeTarget(target: TextEntryTarget): string {
  if (target.identifier) return `identifier "${target.identifier}"`;
  if (target.ref) return `ref "${target.ref}"`;
  if (target.label) return `label "${target.label}"`;
  if (target.text) return `text "${target.text}"`;
  return "the requested point";
}

/** Decide where to put the caret. Throws a GroundingError when no field matches. */
export function planTextEntryFocus(
  nodes: SnapshotNode[],
  target: TextEntryTarget,
): TextEntryFocusPlan {
  let resolution: NamedControlResolution | undefined;
  if (target.ref) {
    const ref = target.ref.replace(/^@/, "");
    const node = nodes.find((item) => item.ref === ref);
    if (node?.rect) {
      resolution = {
        method: "identifier",
        point: { x: node.rect.x + node.rect.width / 2, y: node.rect.y + node.rect.height / 2 },
        bounds: node.rect,
      };
    }
  } else {
    const outcome = resolveNamedControlOutcome(nodes, target);
    if (outcome.status === "resolved") resolution = outcome.resolution;
    else if (!target.point) {
      throw new GroundingError(
        `No text field matched ${describeTarget(target)} (${outcome.detail}). Nothing was typed.`,
      );
    }
  }
  if (!resolution && target.point) {
    resolution = {
      method: "point",
      point: target.point,
      bounds: { ...target.point, width: 1, height: 1 },
    };
  }
  if (!resolution) {
    throw new GroundingError(`No text field matched ${describeTarget(target)}. Nothing was typed.`);
  }
  const field = resolveTextEntryField(nodes, matchedNode(nodes, resolution), resolution.point);
  if (!field?.rect) return { resolution, alreadyFocused: false };
  const point = textEntryFocusPoint(nodes, field) ?? resolution.point;
  return {
    resolution: { method: resolution.method, point, bounds: field.rect },
    field,
    alreadyFocused: field.focused === true,
  };
}
