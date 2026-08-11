import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";

type SnapRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

export type CanvasSnapGuide = {
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
  kind: "alignment" | "spacing";
  segments?: readonly { start: number; end: number }[];
};

export type CanvasSnapResult = {
  delta: CanvasPoint;
  guides: CanvasSnapGuide[];
};

function rectAt(point: CanvasPoint): SnapRect {
  return {
    left: point.x,
    top: point.y,
    right: point.x + SCREEN_CARD_WIDTH,
    bottom: point.y + SCREEN_CARD_HEIGHT,
    centerX: point.x + SCREEN_CARD_WIDTH / 2,
    centerY: point.y + SCREEN_CARD_HEIGHT / 2,
  };
}

function selectionRect(
  ids: readonly string[],
  positions: Readonly<Record<string, CanvasPoint>>,
): SnapRect {
  const rects = ids.flatMap((id) => {
    const position = positions[id];
    return position ? [rectAt(position)] : [];
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

/**
 * Snap a dragged screen (or multi-selection) to visible card alignments and
 * equal gaps. The function is deliberately pure so pointer-move work remains
 * one small O(n) pass and can stay inside the existing animation-frame loop.
 */
export function snapDraggedScreens(input: {
  draggedIds: readonly string[];
  origins: Readonly<Record<string, CanvasPoint>>;
  positions: Readonly<Record<string, CanvasPoint>>;
  candidateDelta: CanvasPoint;
  threshold: number;
}): CanvasSnapResult {
  if (!input.draggedIds.length) return { delta: input.candidateDelta, guides: [] };
  const dragged = new Set(input.draggedIds);
  const origin = selectionRect(input.draggedIds, input.origins);
  const candidate = movedRect(origin, input.candidateDelta);
  const others = Object.entries(input.positions).flatMap(([id, point]) =>
    dragged.has(id) ? [] : [rectAt(point)],
  );
  if (!others.length) return { delta: input.candidateDelta, guides: [] };

  let adjustmentX = 0;
  let adjustmentY = 0;
  let guideX: CanvasSnapGuide | undefined;
  let guideY: CanvasSnapGuide | undefined;
  let distanceX = input.threshold + 1;
  let distanceY = input.threshold + 1;

  for (const target of others) {
    for (const [moving, fixed] of [
      [candidate.left, target.left],
      [candidate.centerX, target.centerX],
      [candidate.right, target.right],
    ] as const) {
      const adjustment = fixed - moving;
      const distance = Math.abs(adjustment);
      if (distance <= input.threshold && distance < distanceX) {
        adjustmentX = adjustment;
        distanceX = distance;
        guideX = {
          axis: "x",
          position: fixed,
          start: Math.min(candidate.top, target.top),
          end: Math.max(candidate.bottom, target.bottom),
          kind: "alignment",
        };
      }
    }
    for (const [moving, fixed] of [
      [candidate.top, target.top],
      [candidate.centerY, target.centerY],
      [candidate.bottom, target.bottom],
    ] as const) {
      const adjustment = fixed - moving;
      const distance = Math.abs(adjustment);
      if (distance <= input.threshold && distance < distanceY) {
        adjustmentY = adjustment;
        distanceY = distance;
        guideY = {
          axis: "y",
          position: fixed,
          start: Math.min(candidate.left, target.left),
          end: Math.max(candidate.right, target.right),
          kind: "alignment",
        };
      }
    }
  }

  const horizontallyRelated = others.filter(
    (rect) => rect.bottom >= candidate.top && rect.top <= candidate.bottom,
  );
  const left = horizontallyRelated
    .filter((rect) => rect.right <= candidate.left)
    .sort((a, b) => b.right - a.right)[0];
  const right = horizontallyRelated
    .filter((rect) => rect.left >= candidate.right)
    .sort((a, b) => a.left - b.left)[0];
  if (left && right) {
    const adjustment = (right.left - candidate.right - (candidate.left - left.right)) / 2;
    const distance = Math.abs(adjustment);
    if (distance <= input.threshold && distance <= distanceX) {
      adjustmentX = adjustment;
      distanceX = distance;
      guideX = {
        axis: "x",
        position: candidate.centerY,
        start: left.right,
        end: right.left,
        kind: "spacing",
        segments: [
          { start: left.right, end: candidate.left + adjustment },
          { start: candidate.right + adjustment, end: right.left },
        ],
      };
    }
  }

  const verticallyRelated = others.filter(
    (rect) => rect.right >= candidate.left && rect.left <= candidate.right,
  );
  const above = verticallyRelated
    .filter((rect) => rect.bottom <= candidate.top)
    .sort((a, b) => b.bottom - a.bottom)[0];
  const below = verticallyRelated
    .filter((rect) => rect.top >= candidate.bottom)
    .sort((a, b) => a.top - b.top)[0];
  if (above && below) {
    const adjustment = (below.top - candidate.bottom - (candidate.top - above.bottom)) / 2;
    const distance = Math.abs(adjustment);
    if (distance <= input.threshold && distance <= distanceY) {
      adjustmentY = adjustment;
      guideY = {
        axis: "y",
        position: candidate.centerX,
        start: above.bottom,
        end: below.top,
        kind: "spacing",
        segments: [
          { start: above.bottom, end: candidate.top + adjustment },
          { start: candidate.bottom + adjustment, end: below.top },
        ],
      };
    }
  }

  return {
    delta: {
      x: input.candidateDelta.x + adjustmentX,
      y: input.candidateDelta.y + adjustmentY,
    },
    guides: [guideX, guideY].filter((guide): guide is CanvasSnapGuide => Boolean(guide)),
  };
}
