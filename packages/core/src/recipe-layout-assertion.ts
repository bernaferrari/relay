import type { StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { nodeMatchesTarget } from "./recipe-target-match.js";

export type LayoutAssertionFailureCode = "unavailable" | "ambiguous" | "overlap";

export type LayoutBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResolvedLayoutElement = {
  target: StepTarget;
  bounds: LayoutBounds;
  nodeIndex?: number;
};

export type NonOverlappingLayoutResult = {
  first: ResolvedLayoutElement;
  second: ResolvedLayoutElement;
  overlap: null;
};

export class LayoutAssertionError extends Error {
  constructor(
    readonly code: LayoutAssertionFailureCode,
    message: string,
    readonly target?: StepTarget,
    readonly bounds?: LayoutBounds,
  ) {
    super(message);
    this.name = "LayoutAssertionError";
  }
}

function validBounds(value: SnapshotNode["rect"]): value is LayoutBounds {
  return Boolean(
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    Number.isFinite(value.height) &&
    value.height > 0,
  );
}

function sameBounds(left: LayoutBounds, right: LayoutBounds): boolean {
  return (
    Math.abs(left.x - right.x) <= 1 &&
    Math.abs(left.y - right.y) <= 1 &&
    Math.abs(left.width - right.width) <= 1 &&
    Math.abs(left.height - right.height) <= 1
  );
}

/** Resolve exactly one visible semantic element with a usable live rect. */
export function resolveLayoutElement(
  nodes: readonly SnapshotNode[],
  target: StepTarget,
): ResolvedLayoutElement {
  const candidates = nodes.filter(
    (node) =>
      node.visibleToUser !== false &&
      node.enabled !== false &&
      validBounds(node.rect) &&
      nodeMatchesTarget(node, target),
  );
  const distinct = candidates.filter((candidate) => {
    const bounds = candidate.rect!;
    return !candidates.some((other) => other !== candidate && sameBounds(bounds, other.rect!));
  });
  if (candidates.length === 0) {
    throw new LayoutAssertionError(
      "unavailable",
      `layout assertion: ${describeLayoutTarget(target)} has no visible element with bounds`,
      target,
    );
  }
  if (distinct.length > 1) {
    throw new LayoutAssertionError(
      "ambiguous",
      `layout assertion: ${describeLayoutTarget(target)} resolved to ${distinct.length} distinct elements`,
      target,
    );
  }
  const node = distinct[0] ?? candidates[0]!;
  return {
    target,
    bounds: node.rect!,
    ...(node.index === undefined ? {} : { nodeIndex: node.index }),
  };
}

function intersection(first: LayoutBounds, second: LayoutBounds): LayoutBounds | null {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function describeLayoutTarget(target: StepTarget): string {
  if (target.identifier) return `identifier ${target.identifier}`;
  if (target.ref) return `ref ${target.ref}`;
  if (target.label) return `label ${JSON.stringify(target.label)}`;
  if (target.text) return `text ${JSON.stringify(target.text)}`;
  return "target";
}

/** Require two uniquely resolved semantic elements to have disjoint areas. */
export function assertNonOverlappingLayout(
  nodes: readonly SnapshotNode[],
  input: { first: StepTarget; second: StepTarget },
): NonOverlappingLayoutResult {
  const first = resolveLayoutElement(nodes, input.first);
  const second = resolveLayoutElement(nodes, input.second);
  const overlap = intersection(first.bounds, second.bounds);
  if (overlap) {
    throw new LayoutAssertionError(
      "overlap",
      `layout assertion: ${describeLayoutTarget(input.first)} overlaps ${describeLayoutTarget(input.second)} by ${Math.round(overlap.width)}×${Math.round(overlap.height)} px`,
      input.second,
      overlap,
    );
  }
  return { first, second, overlap: null };
}
