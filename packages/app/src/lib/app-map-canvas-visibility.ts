import type { CanvasBounds, CanvasEdgeGeometry, CanvasPoint } from "./app-map-canvas-layout";

export type CanvasVisibleBounds = Pick<CanvasBounds, "left" | "top" | "right" | "bottom">;

function pointIsVisible(point: CanvasPoint, bounds: CanvasVisibleBounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

/** Whether the line segment has any point inside or touching the visible
 * canvas rectangle. This catches a long route that crosses the camera even
 * when its lightweight route samples happen to sit outside it. */
function segmentIntersectsVisibleBounds(
  start: CanvasPoint,
  end: CanvasPoint,
  bounds: CanvasVisibleBounds,
): boolean {
  let minimum = 0;
  let maximum = 1;
  const clip = (startCoordinate: number, delta: number, lower: number, upper: number) => {
    if (Math.abs(delta) < Number.EPSILON) {
      return startCoordinate >= lower && startCoordinate <= upper;
    }
    const first = (lower - startCoordinate) / delta;
    const second = (upper - startCoordinate) / delta;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    return minimum <= maximum;
  };

  return (
    clip(start.x, end.x - start.x, bounds.left, bounds.right) &&
    clip(start.y, end.y - start.y, bounds.top, bounds.bottom)
  );
}

/**
 * Keep a connector mounted whenever any visible part of it is relevant to
 * the camera. Endpoint-only virtualisation loses labels for long routes as
 * a close zoom can place both screens outside the overscan while the route's
 * label remains directly in view.
 */
export function canvasEdgeIntersectsVisibleBounds(
  geometry: Pick<CanvasEdgeGeometry, "labelPoint" | "hitPoints">,
  bounds: CanvasVisibleBounds,
): boolean {
  if (pointIsVisible(geometry.labelPoint, bounds)) return true;

  return geometry.hitPoints.some(
    (point, index) =>
      pointIsVisible(point, bounds) ||
      (index > 0 && segmentIntersectsVisibleBounds(geometry.hitPoints[index - 1]!, point, bounds)),
  );
}
