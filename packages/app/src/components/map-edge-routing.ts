/**
 * Geometry for map connections, in the style of FigJam elbow connectors:
 * leave a card horizontally, make one vertical run in the gutter between
 * columns, enter the next card horizontally, with rounded corners. Each
 * connection gets its own vertical lane in every gutter it uses, so parallel
 * runs never merge into a shared bus. Columns a connection skips are crossed
 * through the nearest free gap between cards, never through a card.
 */
import type { MapPoint } from "./map-canvas-geometry";

export type CardBox = { x: number; y: number; width: number; height: number };

/** Centre of the free vertical gap in one column nearest to `wanted`. */
export function freeGapY(column: readonly CardBox[], wanted: number, clearance = 24): number {
  const cards = [...column].sort((a, b) => a.y - b.y);
  if (!cards.length) return wanted;
  if (
    cards.every(
      (card) => wanted < card.y - clearance / 2 || wanted > card.y + card.height + clearance / 2,
    )
  )
    return wanted;
  const candidates: number[] = [cards[0]!.y - clearance];
  for (let index = 1; index < cards.length; index += 1) {
    const above = cards[index - 1]!;
    const below = cards[index]!;
    const gap = below.y - (above.y + above.height);
    if (gap >= clearance) candidates.push(above.y + above.height + gap / 2);
  }
  const last = cards.at(-1)!;
  candidates.push(last.y + last.height + clearance);
  return candidates.reduce((best, y) =>
    Math.abs(y - wanted) < Math.abs(best - wanted) ? y : best,
  );
}

/** One connection to route: horizontal ports on the source's right and the target's left. */
export type ElbowRequest = {
  id: string;
  start: MapPoint;
  end: MapPoint;
};

/** A move from one column's right side to the next column's left side. */
type Hop = { id: string; from: MapPoint; to: MapPoint; gutter: number; index: number };

/**
 * Route every forward connection at once so lanes can be shared out fairly.
 * `columns` maps each column's left x to its cards; `cardWidth` is constant.
 */
export function routeElbows(
  requests: readonly ElbowRequest[],
  columns: ReadonlyMap<number, readonly CardBox[]>,
  cardWidth: number,
): Map<string, MapPoint[]> {
  const columnXs = [...columns.keys()].sort((a, b) => a - b);
  const hops: Hop[] = [];
  const crossings = new Map<string, Array<{ left: number; right: number; y: number }>>();
  for (const request of requests) {
    const skipped = columnXs.filter((x) => x > request.start.x && x + cardWidth < request.end.x);
    const through = skipped.map((x) => {
      const t =
        (x + cardWidth / 2 - request.start.x) / Math.max(1, request.end.x - request.start.x);
      return {
        left: x - 10,
        right: x + cardWidth + 10,
        y: freeGapY(columns.get(x)!, request.start.y + (request.end.y - request.start.y) * t),
      };
    });
    crossings.set(request.id, through);
    const stops = [
      request.start,
      ...through.flatMap((item) => [
        { x: item.left, y: item.y },
        { x: item.right, y: item.y },
      ]),
      request.end,
    ];
    for (let index = 0; index + 1 < stops.length; index += 2) {
      const from = stops[index]!;
      const to = stops[index + 1]!;
      hops.push({ id: request.id, from, to, gutter: Math.round(from.x), index: index / 2 });
    }
  }

  // Lanes per gutter. Moves leaving the same screen in the same direction
  // share one trunk and branch off it, like a tree; moves in opposite
  // directions, or from different screens, never share. Downward trunks: the
  // higher one takes the lane further right; upward ones mirror that. This
  // keeps neighbours from crossing. Lanes sit centred in the gutter.
  const lanes = new Map<string, number>();
  type Unit = { key: string; hops: Hop[]; down: boolean; fromY: number; reach: number };
  const byGutter = new Map<number, Map<string, Unit>>();
  for (const hop of hops) {
    if (Math.abs(hop.from.y - hop.to.y) < 1) continue;
    const down = hop.to.y > hop.from.y;
    const key =
      hop.index === 0
        ? `trunk:${hop.from.x},${hop.from.y}:${down ? "down" : "up"}`
        : `${hop.id}:${hop.index}`;
    const units = byGutter.get(hop.gutter) ?? new Map<string, Unit>();
    const unit = units.get(key) ?? { key, hops: [], down, fromY: hop.from.y, reach: hop.to.y };
    unit.hops.push(hop);
    unit.reach = down ? Math.max(unit.reach, hop.to.y) : Math.min(unit.reach, hop.to.y);
    units.set(key, unit);
    byGutter.set(hop.gutter, units);
  }
  for (const units of byGutter.values()) {
    const all = [...units.values()];
    const ordered = [
      ...all.filter((unit) => unit.down).sort((a, b) => a.fromY - b.fromY || a.reach - b.reach),
      ...all.filter((unit) => !unit.down).sort((a, b) => b.fromY - a.fromY || b.reach - a.reach),
    ];
    const hopsInGutter = all.flatMap((unit) => unit.hops);
    const left = Math.min(...hopsInGutter.map((hop) => hop.from.x)) + 18;
    const right = Math.max(...hopsInGutter.map((hop) => hop.to.x)) - 18;
    const step = Math.min(28, (right - left) / Math.max(1, ordered.length));
    const middle = (left + right) / 2;
    ordered.forEach((unit, index) => {
      const x = middle + ((ordered.length - 1) / 2 - index) * step;
      for (const hop of unit.hops) lanes.set(`${hop.id}:${hop.index}`, x);
    });
  }

  const routes = new Map<string, MapPoint[]>();
  for (const request of requests) {
    const points: MapPoint[] = [];
    for (const hop of hops.filter((item) => item.id === request.id)) {
      points.push(hop.from);
      const lane = lanes.get(`${hop.id}:${hop.index}`);
      if (lane !== undefined) points.push({ x: lane, y: hop.from.y }, { x: lane, y: hop.to.y });
      points.push(hop.to);
    }
    routes.set(request.id, points);
  }
  return routes;
}

/** Orthogonal path with rounded corners; collinear points stay straight. */
export function roundedPath(points: readonly MapPoint[], radius = 14): string {
  const clean = points.filter(
    (point, index) =>
      !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
  if (!clean.length) return "";
  let d = `M ${clean[0]!.x} ${clean[0]!.y}`;
  for (let index = 1; index < clean.length - 1; index += 1) {
    const previous = clean[index - 1]!;
    const current = clean[index]!;
    const next = clean[index + 1]!;
    const before = Math.hypot(current.x - previous.x, current.y - previous.y);
    const after = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, before / 2, after / 2);
    const collinear =
      (current.x - previous.x) * (next.y - current.y) ===
      (current.y - previous.y) * (next.x - current.x);
    if (collinear || r < 0.5) {
      d += ` L ${current.x} ${current.y}`;
      continue;
    }
    const entry = {
      x: current.x + ((previous.x - current.x) * r) / before,
      y: current.y + ((previous.y - current.y) * r) / before,
    };
    const exit = {
      x: current.x + ((next.x - current.x) * r) / after,
      y: current.y + ((next.y - current.y) * r) / after,
    };
    d += ` L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`;
  }
  if (clean.length > 1) d += ` L ${clean.at(-1)!.x} ${clean.at(-1)!.y}`;
  return d;
}

/** An open chevron whose tip is exactly the path's end, pointing along its last segment. */
export function arrowHead(points: readonly MapPoint[], size = 7): string {
  const tip = points.at(-1);
  const before = [...points]
    .reverse()
    .find((point) => tip && (point.x !== tip.x || point.y !== tip.y));
  if (!tip || !before) return "";
  const length = Math.hypot(tip.x - before.x, tip.y - before.y);
  const ux = (tip.x - before.x) / length;
  const uy = (tip.y - before.y) / length;
  const back = { x: tip.x - ux * size, y: tip.y - uy * size };
  const spread = size * 0.72;
  return `M ${back.x - uy * spread} ${back.y + ux * spread} L ${tip.x} ${tip.y} L ${back.x + uy * spread} ${back.y - ux * spread}`;
}

/** An elbow under both cards for a move back to an earlier or the same column. */
export function returnRoute(source: CardBox, target: CardBox, slot = 0): MapPoint[] {
  const start = { x: source.x + source.width / 2, y: source.y + source.height + 8 };
  const end = { x: target.x + target.width / 2 + 12, y: target.y + target.height + 8 };
  const below = Math.max(start.y, end.y) + 28 + slot * 10;
  return [start, { x: start.x, y: below }, { x: end.x, y: below }, end];
}

/** The point halfway along a polyline, where a connector's label is centred. */
export function midpointAlong(points: readonly MapPoint[]): MapPoint {
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (remaining <= length && length > 0) {
      const from = points[index]!;
      const to = points[index + 1]!;
      return {
        x: from.x + ((to.x - from.x) * remaining) / length,
        y: from.y + ((to.y - from.y) * remaining) / length,
      };
    }
    remaining -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}
