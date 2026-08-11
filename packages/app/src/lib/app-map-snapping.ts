import {
  screenCardGeometry,
  screenFrameBounds,
  type CanvasFrameBounds,
  type CanvasFrameGeometry,
  type CanvasPoint,
} from "./app-map-canvas-layout";

type SnapRect = CanvasFrameBounds;

export type CanvasSnapFrame = CanvasFrameGeometry;

export type CanvasSnapGuide = {
  axis: "x" | "y";
  position: number;
  /**
   * Parallel lines rendered in place of `position` for a complete bounds
   * match. Equal-size previews show both shared edges instead of an ambiguous
   * center-only guide.
   */
  parallelPositions?: readonly number[];
  start: number;
  end: number;
  kind: "alignment" | "spacing";
  segments?: readonly { start: number; end: number }[];
  /** World-space distance represented by an equal-spacing guide. */
  gap?: number;
};

export type CanvasSnapLock = {
  axis: "x" | "y";
  key: string;
};

export type CanvasSnapResult = {
  delta: CanvasPoint;
  guides: CanvasSnapGuide[];
  locks: CanvasSnapLock[];
};

type SnapCandidate = {
  axis: "x" | "y";
  key: string;
  adjustment: number;
  distance: number;
  priority: number;
  guide: CanvasSnapGuide;
};

const FALLBACK_GEOMETRY = screenCardGeometry();

function selectionRect(
  ids: readonly string[],
  positions: Readonly<Record<string, CanvasPoint>>,
  geometries: Readonly<Record<string, CanvasSnapFrame>>,
): SnapRect {
  const rects = ids.flatMap((id) => {
    const position = positions[id];
    return position ? [screenFrameBounds(position, geometries[id] ?? FALLBACK_GEOMETRY)] : [];
  });
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

const movedRect = (rect: SnapRect, delta: CanvasPoint): SnapRect => ({
  left: rect.left + delta.x,
  top: rect.top + delta.y,
  right: rect.right + delta.x,
  bottom: rect.bottom + delta.y,
  centerX: rect.centerX + delta.x,
  centerY: rect.centerY + delta.y,
});

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aEnd >= bStart && aStart <= bEnd;

const sameLength = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.abs(aEnd - aStart - (bEnd - bStart)) < 0.001;

/**
 * Keep an equal-spacing ruler on a stationary lane. Anchoring it to the moving
 * preview's center made the ruler drift while the snapped axis stayed locked.
 */
function referenceLane(references: readonly SnapRect[], perpendicularAxis: "x" | "y"): number {
  const starts = references.map((rect) => (perpendicularAxis === "x" ? rect.left : rect.top));
  const ends = references.map((rect) => (perpendicularAxis === "x" ? rect.right : rect.bottom));
  const overlapStart = Math.max(...starts);
  const overlapEnd = Math.min(...ends);
  if (overlapStart <= overlapEnd) return (overlapStart + overlapEnd) / 2;

  // References can have different rows or columns. Their average center is
  // still deterministic and, crucially, does not follow the pointer.
  const centers = references.map((rect) =>
    perpendicularAxis === "x" ? rect.centerX : rect.centerY,
  );
  return centers.reduce((sum, center) => sum + center, 0) / centers.length;
}

function alignmentCandidates(
  candidate: SnapRect,
  target: SnapRect,
  targetIndex: number,
): SnapCandidate[] {
  const sameWidth = sameLength(candidate.left, candidate.right, target.left, target.right);
  const sameHeight = sameLength(candidate.top, candidate.bottom, target.top, target.bottom);
  const xPairs = [
    ["left", candidate.left, "left", target.left, 0],
    ["left", candidate.left, "right", target.right, 2],
    ["right", candidate.right, "left", target.left, 2],
    ["right", candidate.right, "right", target.right, 0],
    ["center", candidate.centerX, "center", target.centerX, 1],
  ] as const;
  const yPairs = [
    ["top", candidate.top, "top", target.top, 0],
    ["top", candidate.top, "bottom", target.bottom, 2],
    ["bottom", candidate.bottom, "top", target.top, 2],
    ["bottom", candidate.bottom, "bottom", target.bottom, 0],
    ["center", candidate.centerY, "center", target.centerY, 1],
  ] as const;
  return [
    ...xPairs.map(([movingName, moving, fixedName, fixed, priority]) => ({
      axis: "x" as const,
      key: `align:x:${targetIndex}:${movingName}:${fixedName}`,
      adjustment: fixed - moving,
      distance: Math.abs(fixed - moving),
      priority,
      guide: {
        axis: "x" as const,
        position: fixed,
        parallelPositions:
          sameWidth && movingName === fixedName ? [target.left, target.right] : undefined,
        start: Math.min(candidate.top, target.top),
        end: Math.max(candidate.bottom, target.bottom),
        kind: "alignment" as const,
      },
    })),
    ...yPairs.map(([movingName, moving, fixedName, fixed, priority]) => ({
      axis: "y" as const,
      key: `align:y:${targetIndex}:${movingName}:${fixedName}`,
      adjustment: fixed - moving,
      distance: Math.abs(fixed - moving),
      priority,
      guide: {
        axis: "y" as const,
        position: fixed,
        parallelPositions:
          sameHeight && movingName === fixedName ? [target.top, target.bottom] : undefined,
        start: Math.min(candidate.left, target.left),
        end: Math.max(candidate.right, target.right),
        kind: "alignment" as const,
      },
    })),
  ];
}

function horizontalSpacingCandidates(candidate: SnapRect, others: SnapRect[]): SnapCandidate[] {
  const related = others
    .filter((rect) => overlaps(rect.top, rect.bottom, candidate.top, candidate.bottom))
    .sort((a, b) => a.left - b.left);
  const results: SnapCandidate[] = [];

  const left = related.filter((rect) => rect.right <= candidate.left).at(-1);
  const right = related.find((rect) => rect.left >= candidate.right);
  if (left && right) {
    const adjustment = (right.left - candidate.right - (candidate.left - left.right)) / 2;
    const moved = movedRect(candidate, { x: adjustment, y: 0 });
    const gap = moved.left - left.right;
    results.push({
      axis: "x",
      key: `space:x:between:${left.right}:${right.left}`,
      adjustment,
      distance: Math.abs(adjustment),
      priority: -2,
      guide: {
        axis: "x",
        position: referenceLane([left, right], "y"),
        start: left.right,
        end: right.left,
        kind: "spacing",
        gap,
        segments: [
          { start: left.right, end: moved.left },
          { start: moved.right, end: right.left },
        ],
      },
    });
  }

  for (let index = 0; index < related.length - 1; index += 1) {
    const first = related[index]!;
    const second = related[index + 1]!;
    const gap = second.left - first.right;
    if (gap < 0) continue;
    const afterAdjustment = second.right + gap - candidate.left;
    const beforeAdjustment = first.left - gap - candidate.right;
    for (const [side, adjustment, segments] of [
      [
        "after",
        afterAdjustment,
        [
          { start: first.right, end: second.left },
          { start: second.right, end: candidate.left + afterAdjustment },
        ],
      ],
      [
        "before",
        beforeAdjustment,
        [
          { start: candidate.right + beforeAdjustment, end: first.left },
          { start: first.right, end: second.left },
        ],
      ],
    ] as const) {
      results.push({
        axis: "x",
        key: `space:x:${side}:${first.right}:${second.left}`,
        adjustment,
        distance: Math.abs(adjustment),
        priority: -1,
        guide: {
          axis: "x",
          position: referenceLane([first, second], "y"),
          start: Math.min(...segments.map((segment) => segment.start)),
          end: Math.max(...segments.map((segment) => segment.end)),
          kind: "spacing",
          gap,
          segments,
        },
      });
    }
  }
  return results;
}

function verticalSpacingCandidates(candidate: SnapRect, others: SnapRect[]): SnapCandidate[] {
  const related = others
    .filter((rect) => overlaps(rect.left, rect.right, candidate.left, candidate.right))
    .sort((a, b) => a.top - b.top);
  const results: SnapCandidate[] = [];

  const above = related.filter((rect) => rect.bottom <= candidate.top).at(-1);
  const below = related.find((rect) => rect.top >= candidate.bottom);
  if (above && below) {
    const adjustment = (below.top - candidate.bottom - (candidate.top - above.bottom)) / 2;
    const moved = movedRect(candidate, { x: 0, y: adjustment });
    const gap = moved.top - above.bottom;
    results.push({
      axis: "y",
      key: `space:y:between:${above.bottom}:${below.top}`,
      adjustment,
      distance: Math.abs(adjustment),
      priority: -2,
      guide: {
        axis: "y",
        position: referenceLane([above, below], "x"),
        start: above.bottom,
        end: below.top,
        kind: "spacing",
        gap,
        segments: [
          { start: above.bottom, end: moved.top },
          { start: moved.bottom, end: below.top },
        ],
      },
    });
  }

  for (let index = 0; index < related.length - 1; index += 1) {
    const first = related[index]!;
    const second = related[index + 1]!;
    const gap = second.top - first.bottom;
    if (gap < 0) continue;
    const afterAdjustment = second.bottom + gap - candidate.top;
    const beforeAdjustment = first.top - gap - candidate.bottom;
    for (const [side, adjustment, segments] of [
      [
        "after",
        afterAdjustment,
        [
          { start: first.bottom, end: second.top },
          { start: second.bottom, end: candidate.top + afterAdjustment },
        ],
      ],
      [
        "before",
        beforeAdjustment,
        [
          { start: candidate.bottom + beforeAdjustment, end: first.top },
          { start: first.bottom, end: second.top },
        ],
      ],
    ] as const) {
      results.push({
        axis: "y",
        key: `space:y:${side}:${first.bottom}:${second.top}`,
        adjustment,
        distance: Math.abs(adjustment),
        priority: -1,
        guide: {
          axis: "y",
          position: referenceLane([first, second], "x"),
          start: Math.min(...segments.map((segment) => segment.start)),
          end: Math.max(...segments.map((segment) => segment.end)),
          kind: "spacing",
          gap,
          segments,
        },
      });
    }
  }
  return results;
}

function bestCandidate(
  candidates: SnapCandidate[],
  axis: "x" | "y",
  threshold: number,
  previousLocks: readonly CanvasSnapLock[],
): SnapCandidate | undefined {
  const sorted = candidates
    .filter((candidate) => candidate.axis === axis && candidate.distance <= threshold)
    .sort(
      (a, b) => a.distance - b.distance || a.priority - b.priority || a.key.localeCompare(b.key),
    );
  const best = sorted[0];
  const previousKey = previousLocks.find((lock) => lock.axis === axis)?.key;
  if (!previousKey) return best;
  const previous = candidates.find(
    (candidate) => candidate.axis === axis && candidate.key === previousKey,
  );
  // Magnetic hysteresis: retain the current relationship through tiny pointer
  // noise, but release promptly when another target is materially closer.
  if (
    previous &&
    previous.distance <= threshold * 1.65 &&
    (!best || previous.distance <= best.distance + threshold * 0.35)
  ) {
    return previous;
  }
  return best;
}

/**
 * Snap a dragged screen (or multi-selection) by its visible preview rectangle.
 * Alignment works on both sides of every edge; spacing works between siblings
 * and before/after an existing equal-gap sequence. The pass remains small for
 * real maps and is scheduled once per animation frame by the gesture layer.
 */
export function snapDraggedScreens(input: {
  draggedIds: readonly string[];
  origins: Readonly<Record<string, CanvasPoint>>;
  positions: Readonly<Record<string, CanvasPoint>>;
  geometries?: Readonly<Record<string, CanvasSnapFrame>>;
  candidateDelta: CanvasPoint;
  threshold: number;
  previousLocks?: readonly CanvasSnapLock[];
}): CanvasSnapResult {
  if (!input.draggedIds.length) {
    return { delta: input.candidateDelta, guides: [], locks: [] };
  }
  const geometries = input.geometries ?? {};
  const dragged = new Set(input.draggedIds);
  const origin = selectionRect(input.draggedIds, input.origins, geometries);
  const candidate = movedRect(origin, input.candidateDelta);
  const others = Object.entries(input.positions).flatMap(([id, point]) =>
    dragged.has(id) ? [] : [screenFrameBounds(point, geometries[id] ?? FALLBACK_GEOMETRY)],
  );
  if (!others.length) return { delta: input.candidateDelta, guides: [], locks: [] };

  const candidates = [
    ...others.flatMap((target, index) => alignmentCandidates(candidate, target, index)),
    ...horizontalSpacingCandidates(candidate, others),
    ...verticalSpacingCandidates(candidate, others),
  ];
  const previousLocks = input.previousLocks ?? [];
  const x = bestCandidate(candidates, "x", input.threshold, previousLocks);
  const y = bestCandidate(candidates, "y", input.threshold, previousLocks);
  const selected = [x, y].filter((value): value is SnapCandidate => Boolean(value));

  return {
    delta: {
      x: input.candidateDelta.x + (x?.adjustment ?? 0),
      y: input.candidateDelta.y + (y?.adjustment ?? 0),
    },
    guides: selected.map(({ guide }) => guide),
    locks: selected.map(({ axis, key }) => ({ axis, key })),
  };
}
