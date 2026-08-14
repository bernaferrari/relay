import type { CanvasEdgeGeometry, CanvasPoint } from "./app-map-canvas-layout";

export function canvasEdgeArrowPath(
  geometry: Pick<CanvasEdgeGeometry, "endPoint" | "endTangentPoint" | "hitPoints">,
  strokeWidth = 2,
): string {
  const end = geometry.endPoint;
  const exactTangent = geometry.endTangentPoint;
  const tangentPoint =
    exactTangent && Math.hypot(end.x - exactTangent.x, end.y - exactTangent.y) > 0.01
      ? exactTangent
      : previousDistinctPoint(geometry.hitPoints, end);
  return tangentPoint ? arrowPathAt(end, tangentPoint, strokeWidth) : "";
}

/** Same geometry as the terminal arrow, mirrored onto the source endpoint.
 * Separating it from rendering means adding or removing arrowheads does not
 * alter the route, its hit path, or any persisted endpoint attachment. */
export function canvasEdgeStartArrowPath(
  geometry: Pick<CanvasEdgeGeometry, "startPoint" | "hitPoints">,
  strokeWidth = 2,
): string {
  const start = geometry.startPoint;
  const nextPoint = nextDistinctPoint(geometry.hitPoints, start);
  return nextPoint ? arrowPathAt(start, nextPoint, strokeWidth) : "";
}

function previousDistinctPoint(points: readonly CanvasPoint[], endpoint: CanvasPoint) {
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const candidate = points[index]!;
    if (Math.hypot(endpoint.x - candidate.x, endpoint.y - candidate.y) > 0.01) return candidate;
  }
  return undefined;
}

function nextDistinctPoint(points: readonly CanvasPoint[], endpoint: CanvasPoint) {
  for (let index = 1; index < points.length; index += 1) {
    const candidate = points[index]!;
    if (Math.hypot(endpoint.x - candidate.x, endpoint.y - candidate.y) > 0.01) return candidate;
  }
  return undefined;
}

function arrowPathAt(tip: CanvasPoint, tangentPoint: CanvasPoint, strokeWidth: number): string {
  const deltaX = tip.x - tangentPoint.x;
  const deltaY = tip.y - tangentPoint.y;
  const distance = Math.hypot(deltaX, deltaY);
  const tangentX = deltaX / distance;
  const tangentY = deltaY / distance;
  const normalX = -tangentY;
  const normalY = tangentX;
  const extraWeight = Math.max(0, strokeWidth - 1);
  // Figma's line arrow is two 45° strokes at the path endpoint. One shared
  // projection keeps both wings equal instead of producing a narrow, swept
  // chevron whose terminal can look hooked on a shallow curve.
  const wing = 7 + extraWeight * 0.75;
  const baseX = tip.x - tangentX * wing;
  const baseY = tip.y - tangentY * wing;
  const first = {
    x: baseX + normalX * wing,
    y: baseY + normalY * wing,
  };
  const second = {
    x: baseX - normalX * wing,
    y: baseY - normalY * wing,
  };

  return `M ${first.x} ${first.y} L ${tip.x} ${tip.y} L ${second.x} ${second.y}`;
}
