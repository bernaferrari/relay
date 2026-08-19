import type { LayoutEdge } from "./app-map-auto-layout-ranking";
import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";

/**
 * What a candidate arrangement costs, read in this order: edges that cross,
 * then the corners they turn, then how far the arrangement moved siblings from
 * the order they were recorded in, then how far the edges run.
 *
 * Ordering matters more than any single number. A crossing is the one thing a
 * reader cannot resolve by looking closer, and a corner is the next, so both
 * outrank the rest. Length comes last because it is the only term that is
 * purely taste: siblings packed side by side on one row are joined by straight
 * edges of differing lengths, and sorting that row shortest-first would buy a
 * few pixels by rewriting the order somebody recorded their taps in.
 */
export type LayoutCost = {
  crossings: number;
  bends: number;
  routeDistance: number;
  siblingMovement: number;
};

export function compareLayoutCost(left: LayoutCost, right: LayoutCost): number {
  return (
    left.crossings - right.crossings ||
    left.bends - right.bends ||
    left.siblingMovement - right.siblingMovement ||
    left.routeDistance - right.routeDistance
  );
}

export function layoutCost(
  positions: Readonly<Record<string, CanvasPoint>>,
  edges: readonly LayoutEdge[],
  originalChildren: ReadonlyMap<string, readonly string[]>,
  children: ReadonlyMap<string, readonly string[]>,
): LayoutCost {
  const drawableEdges = edges.flatMap((edge) => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    return from && to ? [{ ...edge, points: orthogonalProxyRoute(from, to) }] : [];
  });
  let crossings = 0;
  for (let left = 0; left < drawableEdges.length; left += 1) {
    for (let right = left + 1; right < drawableEdges.length; right += 1) {
      const first = drawableEdges[left]!;
      const second = drawableEdges[right]!;
      if (
        first.from === second.from ||
        first.from === second.to ||
        first.to === second.from ||
        first.to === second.to
      ) {
        continue;
      }
      let crossed = false;
      for (let firstSegment = 1; firstSegment < first.points.length; firstSegment += 1) {
        for (let secondSegment = 1; secondSegment < second.points.length; secondSegment += 1) {
          if (
            segmentsProperlyCross(
              first.points[firstSegment - 1]!,
              first.points[firstSegment]!,
              second.points[secondSegment - 1]!,
              second.points[secondSegment]!,
            )
          ) {
            crossed = true;
            break;
          }
        }
        if (crossed) break;
      }
      if (crossed) crossings += 1;
    }
  }
  const routeDistance = drawableEdges.reduce(
    (total, edge) =>
      total +
      edge.points
        .slice(1)
        .reduce(
          (distance, point, index) =>
            distance +
            Math.abs(point.x - edge.points[index]!.x) +
            Math.abs(point.y - edge.points[index]!.y),
          0,
        ),
    0,
  );
  const bends = drawableEdges.reduce(
    (total, edge) => total + Math.max(0, edge.points.length - 2),
    0,
  );
  let siblingMovement = 0;
  for (const [parentId, childIds] of children) {
    const original = originalChildren.get(parentId) ?? [];
    const order = new Map(original.map((childId, index) => [childId, index]));
    for (let left = 0; left < childIds.length; left += 1) {
      for (let right = left + 1; right < childIds.length; right += 1) {
        if ((order.get(childIds[left]!) ?? left) > (order.get(childIds[right]!) ?? right)) {
          siblingMovement += 1;
        }
      }
    }
  }
  return { crossings, bends, routeDistance, siblingMovement };
}

/** A deliberately small proxy for the editor's bent connector: screen edges
 * leave through their facing sides, take one shared corridor rail, then enter
 * the target. It lets auto-layout evaluate the graph as routed geometry
 * without importing renderer state or mutating any persisted position. */
function orthogonalProxyRoute(from: CanvasPoint, to: CanvasPoint): CanvasPoint[] {
  const sourceOnLeft = to.x >= from.x;
  const start = {
    x: from.x + (sourceOnLeft ? SCREEN_CARD_WIDTH : 0),
    y: from.y + SCREEN_CARD_HEIGHT / 2,
  };
  const end = {
    x: to.x + (sourceOnLeft ? 0 : SCREEN_CARD_WIDTH),
    y: to.y + SCREEN_CARD_HEIGHT / 2,
  };
  if (start.y === end.y) return [start, end];
  const railX = (start.x + end.x) / 2;
  return [start, { x: railX, y: start.y }, { x: railX, y: end.y }, end];
}

function segmentsProperlyCross(
  a: CanvasPoint,
  b: CanvasPoint,
  c: CanvasPoint,
  d: CanvasPoint,
): boolean {
  const orientation = (first: CanvasPoint, second: CanvasPoint, third: CanvasPoint) =>
    (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  );
}
