import type { SnapshotNode, SnapshotState, StepTarget } from "../context/server";
import { ancestryOf } from "./snapshot";

export function hasUsableDeviceBounds(
  snapshot: SnapshotState,
): snapshot is NonNullable<SnapshotState> & { bounds: { width: number; height: number } } {
  const bounds = snapshot?.bounds;
  return Boolean(
    bounds &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 1 &&
    bounds.height > 1,
  );
}

/** Logical stage size: AX bounds, else retina screenshot mapped to points. */
export function logicalBoundsFromCapture(input: {
  snapshot?: SnapshotState;
  imageWidth?: number;
  imageHeight?: number;
}): { width: number; height: number } | undefined {
  const snapshot = input.snapshot ?? null;
  if (hasUsableDeviceBounds(snapshot)) return snapshot.bounds;
  const width = input.imageWidth ?? 0;
  const height = input.imageHeight ?? 0;
  if (width > 1 && height > 1) {
    const scale = width >= 1000 && height >= 1000 ? 2 : 1;
    return { width: Math.round(width / scale), height: Math.round(height / scale) };
  }
  return undefined;
}

export function buildTapTarget(
  bounds: { width: number; height: number } | undefined,
  node: SnapshotNode | null,
  fx: number,
  fy: number,
): StepTarget {
  const width = bounds?.width ?? 1;
  const height = bounds?.height ?? 1;
  const point = {
    x: Math.round(fx * width),
    y: Math.round(fy * height),
    anchor: { horizontal: "left", vertical: "top" } as const,
    ...(bounds ? { referenceBounds: { ...bounds } } : {}),
  };
  if (!node) return { point };
  const label = (node.label ?? node.value ?? "").trim();
  return {
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.ref ? { ref: node.ref.startsWith("@") ? node.ref : `@${node.ref}` } : {}),
    ...(label ? { label } : {}),
    point,
  };
}

/**
 * A live Android click may outlive the accessibility frame used to decorate
 * it. Keep frame-scoped refs for evidence review, but execute with a stable
 * selector (or the exact mirrored point) so a background snapshot cannot turn
 * a responsive click into a delayed expired-ref failure.
 */
export function stableLiveTapStep(
  target: StepTarget,
):
  | { kind: "identifier"; identifier: string; point?: { x: number; y: number } }
  | { kind: "label"; label: string; point?: { x: number; y: number } }
  | { kind: "point"; x: number; y: number }
  | null {
  const point = target.point ? { x: target.point.x, y: target.point.y } : undefined;
  if (target.identifier)
    return { kind: "identifier", identifier: target.identifier, ...(point ? { point } : {}) };
  if (target.label) return { kind: "label", label: target.label, ...(point ? { point } : {}) };
  return point ? { kind: "point", ...point } : null;
}

export function semanticTapNode(
  snapshot: SnapshotState,
  node: SnapshotNode | null,
): SnapshotNode | null {
  if (!snapshot || !node) return node;
  const screenArea = snapshot.bounds ? snapshot.bounds.width * snapshot.bounds.height : Infinity;
  const candidates = ancestryOf(snapshot, node).filter((candidate) => {
    const rect = candidate.rect;
    return !rect || rect.width * rect.height <= screenArea * 0.35;
  });
  // Full-screen overlays are implementation detail, not mouse targets. A stale
  // overlay id is especially harmful because it delays the click and can apply
  // its coordinate fallback after another app has foregrounded. Keep the
  // nearest bounded label, then a genuinely actionable bounded node; otherwise
  // execute the exact mirrored point.
  return (
    candidates.find((candidate) => Boolean((candidate.label ?? candidate.value ?? "").trim())) ??
    candidates.find((candidate) => Boolean(candidate.hittable && candidate.identifier)) ??
    null
  );
}

/**
 * iOS pixel preview can outlive its XCTest tree. A tree remains useful as
 * evidence after input, but it must not silently steer the next interaction
 * unless runtime readiness proves that its geometry is current. Android's
 * existing snapshot lifecycle remains unchanged.
 */
export function currentIosSemanticGeometry(snapshot: SnapshotState): boolean {
  const semantic = snapshot?.readiness?.semanticControl;
  return semantic?.state === "proven" && semantic.freshness === "current";
}

export function canRetryTapAtPoint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /selector did not match|expired ref|ref frame|invalid ref|no longer valid|stale/i.test(
    message,
  );
}

function nodeCenter(
  node: SnapshotNode | null,
  fallback?: { x: number; y: number },
): { x: number; y: number } | undefined {
  const rect = node?.rect;
  if (
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    rect.width > 1 &&
    rect.height > 1
  ) {
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  }
  if (fallback && Number.isFinite(fallback.x) && Number.isFinite(fallback.y)) return fallback;
  return undefined;
}

function uniqueIdentifierCount(snapshot: SnapshotState, identifier: string): number {
  return (
    snapshot?.nodes.filter((candidate) => (candidate.identifier ?? "").trim() === identifier)
      .length ?? 0
  );
}

function uniqueLabelCount(snapshot: SnapshotState, label: string): number {
  const normalized = label.trim().toLocaleLowerCase();
  return (
    snapshot?.nodes.filter(
      (candidate) =>
        (candidate.label ?? candidate.value ?? "").trim().toLocaleLowerCase() === normalized,
    ).length ?? 0
  );
}

/**
 * Live iOS still prefers a coordinate (refs expire), but a unique identifier
 * or unique hittable label is how Grok chrome actually opens. Tap the control
 * center, not the finger glyph. Duplicate non-hittable labels stay exact-point.
 */
export type PhysicalIosTapStep =
  | { kind: "ref"; ref: string }
  | { kind: "identifier"; identifier: string; x: number; y: number }
  | { kind: "label"; label: string; x: number; y: number }
  | { kind: "point"; x: number; y: number };

/** Preserve semantic intent in an authored iOS action while keeping its
 * reviewed fallback point. XCTest refs are frame scoped, so they never become
 * the only durable targeting fact. */
export function authoringTargetFromPhysicalIosStep(
  step: PhysicalIosTapStep | null,
  target: StepTarget,
): StepTarget {
  if (step?.kind === "ref") {
    return { ref: step.ref, ...(target.point ? { point: target.point } : {}) };
  }
  if (step?.kind === "identifier") {
    return { identifier: step.identifier, point: { x: step.x, y: step.y } };
  }
  if (step?.kind === "label") {
    return { label: step.label, point: { x: step.x, y: step.y } };
  }
  return step ? { point: { x: step.x, y: step.y } } : target;
}

export function physicalIosTapStep(
  snapshot: SnapshotState,
  node: SnapshotNode | null,
  target: StepTarget,
  options?: { preferRef?: boolean },
): PhysicalIosTapStep | null {
  if (options?.preferRef && node?.hittable === true && target.ref) {
    return { kind: "ref", ref: target.ref };
  }

  const identifier = target.identifier?.trim();
  if (identifier && uniqueIdentifierCount(snapshot, identifier) === 1) {
    const point = nodeCenter(node, target.point);
    if (point) return { kind: "identifier", identifier, x: point.x, y: point.y };
  }

  if (target.label && node?.hittable !== false && uniqueLabelCount(snapshot, target.label) === 1) {
    const point = nodeCenter(node, target.point);
    if (point) return { kind: "label", label: target.label, x: point.x, y: point.y };
  }

  return target.point ? { kind: "point", x: target.point.x, y: target.point.y } : null;
}
