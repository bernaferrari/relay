import type { SnapshotNode } from "./device.js";

export function center(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}

export type SemanticSnapshotTarget = {
  identifier?: string;
  ref?: string;
  label?: string;
  text?: string;
};

export type SnapshotTargetRegion = {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
};

export const INTERACTIVE_SNAPSHOT_ROLES = new Set([
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

/** Status-bar crumbs and 20px captions are unique matches that still waste a tap.
 * Prefer a real row; if nothing usable exists, treat the query as unmatched. */
function isUsableTapTarget(node: SnapshotNode): boolean {
  const rect = node.rect;
  if (!rect) return false;
  if (rect.width * rect.height < 40 * 24) return false;
  if (rect.y + rect.height <= 36 && rect.x + rect.width <= 80) return false;
  return true;
}

/** XCTest can mark the application/window container itself as hittable. It is
 * never an activation target for a descendant: using its centre turns a
 * semantic press into an accidental tap in the middle of the app. */
function isActivationContainer(node: SnapshotNode): boolean {
  const role = (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
  return role === "application" || role === "window";
}

type SnapshotTargetResolution = {
  node: SnapshotNode;
  point: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  usesActivationAncestor: boolean;
  revealDirection?: "up" | "down";
};

/**
 * Resolve one semantic target to a coordinate without pretending an ambiguous
 * accessibility result is safe. Physical iOS apps occasionally expose visible
 * controls as `hittable:false` even though XCTest can activate their bounds.
 * The result retains the exact current-tree node so activation policy never
 * has to infer selector trust from a platform or a recorded coordinate.
 */
function resolveSnapshotTarget(
  nodes: SnapshotNode[],
  target: SemanticSnapshotTarget,
  region?: SnapshotTargetRegion,
): SnapshotTargetResolution | undefined {
  const normalized = {
    identifier: target.identifier?.trim().toLocaleLowerCase(),
    ref: target.ref?.replace(/^@/u, "").trim().toLocaleLowerCase(),
    label: target.label?.trim().toLocaleLowerCase(),
    text: target.text?.trim().toLocaleLowerCase(),
  };
  const nodesByIndex = new Map(
    nodes.flatMap((node) => (typeof node.index === "number" ? [[node.index, node] as const] : [])),
  );
  const closestHittableAncestor = (node: SnapshotNode): SnapshotNode | undefined => {
    let parentIndex = node.parentIndex;
    while (typeof parentIndex === "number") {
      const parent = nodesByIndex.get(parentIndex);
      if (!parent) return undefined;
      if (parent.hittable && isUsableTapTarget(parent) && !isActivationContainer(parent)) {
        return parent;
      }
      parentIndex = parent.parentIndex;
    }
    return undefined;
  };
  const explicitViewport =
    nodes.find((node) => (node.type ?? node.role)?.toLocaleLowerCase() === "application")?.rect ??
    nodes.find((node) => (node.type ?? node.role)?.toLocaleLowerCase() === "window")?.rect;
  const inferredViewport = nodes
    .filter(
      (node) =>
        node.rect &&
        node.rect.x <= 0 &&
        node.rect.y <= 0 &&
        node.rect.width >= 320 &&
        node.rect.height >= 480,
    )
    .sort(
      (left, right) =>
        right.rect!.width * right.rect!.height - left.rect!.width * left.rect!.height,
    )[0]?.rect;
  const viewport = explicitViewport ?? inferredViewport;
  const fixedChrome = viewport
    ? nodes.flatMap((node) => {
        const rect = node.rect;
        if (
          !rect ||
          rect.width < viewport.width * 0.9 ||
          rect.height < 36 ||
          rect.height > viewport.height * 0.3
        ) {
          return [];
        }
        const spansLeftEdge = rect.x <= viewport.x;
        const atTop = spansLeftEdge && rect.y <= viewport.y;
        const atBottom = spansLeftEdge && rect.y + rect.height >= viewport.y + viewport.height;
        return atTop || atBottom ? [rect] : [];
      })
    : [];
  const safeTop = Math.max(
    viewport?.y ?? Number.NEGATIVE_INFINITY,
    ...fixedChrome
      .filter((rect) => rect.y <= (viewport?.y ?? 0))
      .map((rect) => rect.y + rect.height),
  );
  const safeBottom = Math.min(
    viewport ? viewport.y + viewport.height : Number.POSITIVE_INFINITY,
    ...fixedChrome
      .filter((rect) => viewport && rect.y + rect.height >= viewport.y + viewport.height)
      .map((rect) => rect.y),
  );
  if (region && (!viewport || viewport.width <= 0 || viewport.height <= 0)) return undefined;
  const candidates = nodes
    .filter((node) => {
      if (
        !node.rect ||
        node.rect.width <= 0 ||
        node.rect.height <= 0 ||
        node.enabled === false ||
        node.visibleToUser === false
      ) {
        return false;
      }
      if (!isUsableTapTarget(node)) return false;
      if (region && viewport) {
        const point = center(node.rect);
        const x = (point.x - viewport.x) / viewport.width;
        const y = (point.y - viewport.y) / viewport.height;
        if (
          (region.minX !== undefined && x < region.minX) ||
          (region.maxX !== undefined && x > region.maxX) ||
          (region.minY !== undefined && y < region.minY) ||
          (region.maxY !== undefined && y > region.maxY)
        ) {
          return false;
        }
      }
      if (normalized.identifier) {
        return node.identifier?.trim().toLocaleLowerCase() === normalized.identifier;
      }
      if (normalized.ref)
        return node.ref?.replace(/^@/u, "").toLocaleLowerCase() === normalized.ref;
      if (normalized.label) return node.label?.trim().toLocaleLowerCase() === normalized.label;
      if (normalized.text) {
        return [node.label, node.value, node.identifier].some((value) =>
          value?.toLocaleLowerCase().includes(normalized.text!),
        );
      }
      return false;
    })
    .map((node) => {
      const role = (node.role ?? node.type ?? "").toLocaleLowerCase();
      const activationNode = closestHittableAncestor(node);
      const activationRect = activationNode?.rect ?? node.rect!;
      const point = center(activationRect);
      if (viewport && (point.x < viewport.x || point.x > viewport.x + viewport.width)) {
        return undefined;
      }
      return {
        node,
        point,
        bounds: activationRect,
        usesActivationAncestor: activationNode !== undefined,
        ...(point.y < safeTop
          ? { revealDirection: "up" as const }
          : point.y > safeBottom
            ? { revealDirection: "down" as const }
            : {}),
        // Compose often places the title inside an unlabeled tappable row.
        // Prefer that row over an identically named section heading or
        // caption, while retaining the child label for semantic matching.
        rank:
          (INTERACTIVE_SNAPSHOT_ROLES.has(role) ? 4 : 0) +
          (node.hittable ? 2 : 0) +
          (activationNode ? 3 : 0),
        area: activationRect.width * activationRect.height,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  if (candidates.length === 0) return undefined;

  const bestRank = Math.max(...candidates.map((candidate) => candidate.rank));
  const best = candidates.filter((candidate) => candidate.rank === bestRank);
  const distinct = best.filter(
    (candidate, index) =>
      best.findIndex(
        (other) =>
          Math.abs(other.point.x - candidate.point.x) <= 4 &&
          Math.abs(other.point.y - candidate.point.y) <= 4,
      ) === index,
  );
  if (distinct.length !== 1) return undefined;

  const selected = best
    .filter(
      (candidate) =>
        Math.abs(candidate.point.x - distinct[0]!.point.x) <= 4 &&
        Math.abs(candidate.point.y - distinct[0]!.point.y) <= 4,
    )
    .sort(
      (left, right) => left.area - right.area || (right.node.depth ?? 0) - (left.node.depth ?? 0),
    )[0];
  return selected
    ? {
        node: selected.node,
        point: selected.point,
        bounds: selected.bounds,
        usesActivationAncestor: selected.usesActivationAncestor,
        ...("revealDirection" in selected && selected.revealDirection
          ? { revealDirection: selected.revealDirection }
          : {}),
      }
    : undefined;
}

export function resolveSnapshotTargetPoint(
  nodes: SnapshotNode[],
  target: SemanticSnapshotTarget,
  region?: SnapshotTargetRegion,
): { x: number; y: number } | undefined {
  const resolution = resolveSnapshotTarget(nodes, target, region);
  return resolution?.revealDirection ? undefined : resolution?.point;
}

export function resolveSnapshotTargetRevealDirection(
  nodes: SnapshotNode[],
  target: SemanticSnapshotTarget,
): "up" | "down" | undefined {
  return resolveSnapshotTarget(nodes, target)?.revealDirection;
}

export type NamedControlTarget = {
  identifier?: string;
  label?: string;
  text?: string;
  point?: { x: number; y: number };
  /** Exact Android package allowed to replace the current foreground app. */
  expectedApp?: string;
};

export type NamedControlMethod = "identifier" | "label" | "text" | "point";

export type NamedControlResolution = {
  method: NamedControlMethod;
  point: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * The current accessibility snapshot proved a unique semantic match whose
   * native selector is specifically untrustworthy. Use the live snapshot's
   * activation bounds instead. This is never inferred from platform alone and
   * never carries a recorded point forward.
   */
  activation?: "snapshot-point";
};

export function explicitPointResolution(
  point: { x: number; y: number } | undefined,
): NamedControlResolution | undefined {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return {
    method: "point",
    point: { x: point.x, y: point.y },
    bounds: { x: point.x, y: point.y, width: 1, height: 1 },
  };
}

/**
 * Shared mouse + recipe tap policy: identifier → label → text → explicit point.
 * Ambiguous labels do not guess; callers must supply a point fallback.
 * A non-hittable child with a current hittable ancestor uses that ancestor's
 * bounds. An authored row whose tree does not report selector hittability uses
 * its unique live bounds instead of its saved point. Otherwise selectors stay
 * first, and a caller point remains only the fallback when no name resolves.
 */
export function resolveNamedControl(
  nodes: SnapshotNode[],
  target: NamedControlTarget,
): NamedControlResolution | undefined {
  const resolve = (
    method: Exclude<NamedControlMethod, "point">,
    value: string | undefined,
  ): NamedControlResolution | undefined => {
    if (!value?.trim()) return undefined;
    const hit = resolveSnapshotTarget(nodes, { [method]: value });
    if (!hit) return undefined;
    const hasVerifiedCurrentPoint =
      (hit.node.hittable === false && hit.usesActivationAncestor) ||
      (hit.node.hittable === undefined && explicitPointResolution(target.point) !== undefined);
    return {
      method,
      point: hit.point,
      bounds: hit.bounds,
      ...(hasVerifiedCurrentPoint ? { activation: "snapshot-point" as const } : {}),
    };
  };

  const byIdentifier = resolve("identifier", target.identifier);
  if (byIdentifier) return byIdentifier;

  return (
    resolve("label", target.label) ??
    resolve("text", target.text) ??
    explicitPointResolution(target.point)
  );
}
