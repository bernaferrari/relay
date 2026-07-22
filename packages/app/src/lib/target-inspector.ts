import type {
  HorizontalCoordinateAnchor,
  RecordedNodeEvidence,
  RecordedStepEvidence,
  StepPoint,
  StepTarget,
  VerticalCoordinateAnchor,
} from "./api-types";

export type TargetAnchor = "top-left" | "top-right" | "center" | "bottom-left" | "bottom-right";
export type HorizontalConstraint = HorizontalCoordinateAnchor;
export type VerticalConstraint = VerticalCoordinateAnchor;

export const DEFAULT_COORDINATE_ANCHOR = {
  horizontal: "left",
  vertical: "top",
} as const;

export function coordinateAnchor(point: StepPoint | undefined): {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
} {
  return point?.anchor ?? DEFAULT_COORDINATE_ANCHOR;
}

export function anchoredPoint(
  point: StepPoint,
  horizontal: HorizontalConstraint,
  vertical: VerticalConstraint,
  referenceBounds: { width: number; height: number } | undefined,
): StepPoint {
  return {
    ...point,
    anchor: { horizontal, vertical },
    ...(referenceBounds ? { referenceBounds: { ...referenceBounds } } : {}),
  };
}

export const TARGET_ANCHORS: { id: TargetAnchor; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "center", label: "Center" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

export function targetHierarchy(
  evidence: RecordedStepEvidence | undefined,
): RecordedNodeEvidence[] {
  if (!evidence?.node) return [];
  const candidates = [evidence.node, ...(evidence.ancestors ?? [])];
  const bounds = evidence.deviceBounds;
  const result: RecordedNodeEvidence[] = [];
  const validRect = (node: RecordedNodeEvidence) => {
    const rect = node.rect;
    return (
      rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const sameBounds = (a: RecordedNodeEvidence, b: RecordedNodeEvidence) =>
    a.rect &&
    b.rect &&
    Math.abs(a.rect.x - b.rect.x) <= 1 &&
    Math.abs(a.rect.y - b.rect.y) <= 1 &&
    Math.abs(a.rect.width - b.rect.width) <= 1 &&
    Math.abs(a.rect.height - b.rect.height) <= 1;
  const hasIdentity = (node: RecordedNodeEvidence) =>
    Boolean(
      node.label?.trim() || node.value?.trim() || node.identifier?.trim() || node.role?.trim(),
    );
  const fillsDevice = (node: RecordedNodeEvidence) => {
    if (!bounds || !node.rect) return false;
    const right = node.rect.x + node.rect.width;
    const bottom = node.rect.y + node.rect.height;
    return (
      node.rect.x <= bounds.width * 0.01 &&
      node.rect.y <= bounds.height * 0.01 &&
      right >= bounds.width * 0.99 &&
      bottom >= bounds.height * 0.99
    );
  };

  for (const [index, node] of candidates.entries()) {
    if (!validRect(node)) continue;
    // Android accessibility trees often end in several anonymous, screen-sized
    // View wrappers. They are implementation detail, not useful tap scopes.
    if (index > 0 && fillsDevice(node) && !hasIdentity(node)) continue;
    if (result.some((previous) => sameBounds(previous, node))) continue;
    result.push(node);
  }
  return result;
}

export function recordedTargetNodes(
  evidence: RecordedStepEvidence | undefined,
): RecordedNodeEvidence[] {
  if (!evidence) return [];
  const bounds = evidence.deviceBounds;
  const source = evidence.nodes?.length ? evidence.nodes : targetHierarchy(evidence);
  const seen = new Set<string>();
  return source
    .filter((node) => {
      const rect = node.rect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      if (
        bounds &&
        rect.width * rect.height >= bounds.width * bounds.height * 0.92 &&
        !(node.label || node.value || node.identifier)
      )
        return false;
      const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const ar = a.rect!;
      const br = b.rect!;
      return ar.width * ar.height - br.width * br.height;
    });
}

export function recordedNodeMatches(
  left: RecordedNodeEvidence | undefined,
  right: RecordedNodeEvidence | undefined,
): boolean {
  if (!left || !right) return false;
  if (left.ref && right.ref) return left.ref === right.ref;
  if (left.index !== undefined && right.index !== undefined) return left.index === right.index;
  const a = left.rect;
  const b = right.rect;
  return Boolean(
    a &&
    b &&
    Math.abs(a.x - b.x) <= 1 &&
    Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1,
  );
}

/** Reconstruct a selected screen node's ancestry, including sibling picks. */
export function recordedNodeHierarchy(
  evidence: RecordedStepEvidence,
  selected: RecordedNodeEvidence,
): RecordedNodeEvidence[] {
  const nodes = evidence.nodes ?? [];
  const byIndex = new Map<number, RecordedNodeEvidence>();
  nodes.forEach((node, position) => byIndex.set(node.index ?? position, node));
  const structural = nodes.some((node) => node.parentIndex !== undefined);
  let chain: RecordedNodeEvidence[];

  if (structural) {
    chain = [selected];
    const seen = new Set<number>();
    let current: RecordedNodeEvidence | undefined = selected;
    while (current?.parentIndex !== undefined && !seen.has(current.parentIndex)) {
      seen.add(current.parentIndex);
      const parent = byIndex.get(current.parentIndex);
      if (!parent || recordedNodeMatches(parent, current)) break;
      chain.push(parent);
      current = parent;
    }
  } else {
    const selectedRect = selected.rect;
    chain = selectedRect
      ? nodes
          .filter((candidate) => {
            const rect = candidate.rect;
            return (
              rect &&
              rect.x <= selectedRect.x &&
              rect.y <= selectedRect.y &&
              rect.x + rect.width >= selectedRect.x + selectedRect.width &&
              rect.y + rect.height >= selectedRect.y + selectedRect.height
            );
          })
          .sort((a, b) => a.rect!.width * a.rect!.height - b.rect!.width * b.rect!.height)
      : [selected];
    if (!chain.some((candidate) => recordedNodeMatches(candidate, selected))) {
      chain.unshift(selected);
    }
  }

  return targetHierarchy({ ...evidence, node: chain[0] ?? selected, ancestors: chain.slice(1) });
}

export function targetNodeIndex(
  evidence: RecordedStepEvidence | undefined,
  target: StepTarget,
): number {
  const hierarchy = targetHierarchy(evidence);
  const exact = hierarchy.findIndex((node) => {
    if (target.ref && node.ref === target.ref) return true;
    if (target.label && (node.label === target.label || node.value === target.label)) return true;
    if (target.text && (node.value === target.text || node.label === target.text)) return true;
    return false;
  });
  if (exact >= 0) return exact;
  if (!target.point) return 0;
  const containing = hierarchy.findIndex((node) => {
    const rect = node.rect;
    return (
      rect &&
      target.point!.x >= rect.x &&
      target.point!.x <= rect.x + rect.width &&
      target.point!.y >= rect.y &&
      target.point!.y <= rect.y + rect.height
    );
  });
  return containing >= 0 ? containing : 0;
}

/** Resolve a Figma-style anchor to a tap-safe point just inside the bounds. */
export function pointForConstraints(
  node: RecordedNodeEvidence,
  horizontal: HorizontalConstraint,
  vertical: VerticalConstraint,
): { x: number; y: number } | undefined {
  const rect = node.rect;
  if (!rect) return undefined;
  const insetX = Math.min(12, Math.max(1, rect.width * 0.08));
  const insetY = Math.min(12, Math.max(1, rect.height * 0.08));
  const x =
    horizontal === "left"
      ? rect.x + insetX
      : horizontal === "right"
        ? rect.x + rect.width - insetX
        : rect.x + rect.width / 2;
  const y =
    vertical === "top"
      ? rect.y + insetY
      : vertical === "bottom"
        ? rect.y + rect.height - insetY
        : rect.y + rect.height / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Resolve the five legacy shortcut anchors through the two-axis constraint model. */
export function pointForAnchor(
  node: RecordedNodeEvidence,
  anchor: TargetAnchor,
): { x: number; y: number } | undefined {
  switch (anchor) {
    case "top-left":
      return pointForConstraints(node, "left", "top");
    case "top-right":
      return pointForConstraints(node, "right", "top");
    case "center":
      return pointForConstraints(node, "center", "center");
    case "bottom-left":
      return pointForConstraints(node, "left", "bottom");
    case "bottom-right":
      return pointForConstraints(node, "right", "bottom");
  }
}

export function targetHighlight(
  node: RecordedNodeEvidence | undefined,
  bounds: { width: number; height: number } | undefined,
): { left: string; top: string; width: string; height: string } | undefined {
  if (!node?.rect || !bounds?.width || !bounds.height) return undefined;
  const left = Math.max(0, Math.min(node.rect.x, bounds.width));
  const top = Math.max(0, Math.min(node.rect.y, bounds.height));
  const right = Math.max(left, Math.min(node.rect.x + node.rect.width, bounds.width));
  const bottom = Math.max(top, Math.min(node.rect.y + node.rect.height, bounds.height));
  return {
    left: `${(left / bounds.width) * 100}%`,
    top: `${(top / bounds.height) * 100}%`,
    width: `${((right - left) / bounds.width) * 100}%`,
    height: `${((bottom - top) / bounds.height) * 100}%`,
  };
}

/** Map a literal device coordinate to the recorded screen preview. */
export function targetPointGuide(
  point: StepPoint | undefined,
  bounds: { width: number; height: number } | undefined,
):
  | {
      left: string;
      top: string;
      x: number;
      y: number;
      horizontalGuide: { left: string; width: string };
      verticalGuide: { top: string; height: string };
      horizontalOrigin: string;
      verticalOrigin: string;
    }
  | undefined {
  if (!point || !bounds?.width || !bounds.height) return undefined;
  const x = Math.max(0, Math.min(Math.round(point.x), bounds.width));
  const y = Math.max(0, Math.min(Math.round(point.y), bounds.height));
  const xPercent = (x / bounds.width) * 100;
  const yPercent = (y / bounds.height) * 100;
  const constraints = coordinateAnchor(point);
  const horizontalOrigin =
    constraints.horizontal === "left" ? 0 : constraints.horizontal === "right" ? 100 : 50;
  const verticalOrigin =
    constraints.vertical === "top" ? 0 : constraints.vertical === "bottom" ? 100 : 50;
  return {
    left: `${xPercent}%`,
    top: `${yPercent}%`,
    x,
    y,
    horizontalGuide: {
      left: `${Math.min(xPercent, horizontalOrigin)}%`,
      width: `${Math.abs(xPercent - horizontalOrigin)}%`,
    },
    verticalGuide: {
      top: `${Math.min(yPercent, verticalOrigin)}%`,
      height: `${Math.abs(yPercent - verticalOrigin)}%`,
    },
    horizontalOrigin: `${horizontalOrigin}%`,
    verticalOrigin: `${verticalOrigin}%`,
  };
}

export function recordedNodeName(node: RecordedNodeEvidence | undefined): string {
  return (node?.label ?? node?.value ?? node?.identifier ?? "").trim() || "Unlabelled element";
}
