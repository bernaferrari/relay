import type { MapPoint } from "./map-canvas-geometry";

/** Separate forward elbows, reserving the end of each lane for its label. */
export function forwardRoute(
  start: MapPoint,
  end: MapPoint,
  sourceRight: number,
  slot: number,
  count: number,
  corridorEnd = end.x,
) {
  if (Math.abs(start.y - end.y) < 1) return [start, end];
  const left = Math.max(start.x + 20, sourceRight + 28);
  const right = Math.max(left, corridorEnd - 128);
  const spacing = Math.min(12, (right - left) / Math.max(1, count - 1));
  // For downward routes the longest line stays nearest the source; upward
  // routes reverse that order so horizontal exits do not cross sibling trunks.
  const index = end.y < start.y ? slot : count - slot - 1;
  const lane = left + Math.max(0, index) * spacing;
  return [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end];
}

export type RouteObstacle = { x: number; y: number; width: number; height: number };
export function routeCrossesBox(a: MapPoint, b: MapPoint, box: RouteObstacle) {
  if (a.x === b.x)
    return (
      a.x > box.x &&
      a.x < box.x + box.width &&
      Math.max(a.y, b.y) > box.y &&
      Math.min(a.y, b.y) < box.y + box.height
    );
  return (
    a.y > box.y &&
    a.y < box.y + box.height &&
    Math.max(a.x, b.x) > box.x &&
    Math.min(a.x, b.x) < box.x + box.width
  );
}

/** Keep long orthogonal routes out of intervening preview/title rectangles. */
export function avoidPreviewObstacles(points: MapPoint[], obstacles: readonly RouteObstacle[]) {
  const clear = (route: MapPoint[]) =>
    route
      .slice(1)
      .every((point, index) =>
        obstacles.every((box) => !routeCrossesBox(route[index]!, point, box)),
      );
  if (clear(points)) return points;
  const start = points[0]!,
    end = points.at(-1)!;
  const xs = new Set([
    start.x + 24,
    ...points.slice(1, -1).map((point) => point.x),
    ...obstacles.flatMap((box) => [box.x - 16, box.x + box.width + 16]),
  ]);
  const ys = new Set(obstacles.flatMap((box) => [box.y - 16, box.y + box.height + 16]));
  let best: MapPoint[] | undefined,
    cost = Infinity;
  for (const x of xs) {
    if (x <= start.x || x >= end.x) continue;
    for (const y of ys) {
      const route = [
        start,
        { x, y: start.y },
        { x, y },
        { x: end.x - 24, y },
        { x: end.x - 24, y: end.y },
        end,
      ];
      const length = route
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum + Math.abs(point.x - route[index]!.x) + Math.abs(point.y - route[index]!.y),
          0,
        );
      if (length < cost && clear(route)) {
        best = route;
        cost = length;
      }
    }
  }
  return best ?? points;
}
