/**
 * Layered (Sugiyama-style) map layout: screens go into columns by distance
 * from the entry, each column is ordered to reduce crossings, and an edge that
 * skips columns gets a reserved slot in every column it passes through. Edges
 * therefore only ever run through gutters and reserved slots, never cards.
 *
 * Edges that go back to an earlier or the same column (returns, cycles) do
 * not shape the layout; the canvas shows them only on selection. The edge
 * renderer finds the reserved gaps itself, so manual drags keep working.
 */
import type { MapPoint } from "./map-canvas-geometry";

export type LayeredEdge = { from: string; to: string };

export type LayeredOptions = {
  width: number;
  height: number;
  columnGap?: number;
  rowGap?: number;
  /** Height reserved in a column for an edge passing through it. */
  laneHeight?: number;
  roots?: readonly string[];
};

type Item = { id: string; dummy: boolean; height: number };

export function layeredMapLayout(
  ids: readonly string[],
  edges: readonly LayeredEdge[],
  options: LayeredOptions,
): Map<string, MapPoint> {
  const columnGap = options.columnGap ?? 200;
  const rowGap = options.rowGap ?? 64;
  const laneHeight = options.laneHeight ?? 28;
  const known = new Set(ids);
  const successors = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const { from, to } of edges) {
    if (!known.has(from) || !known.has(to) || from === to) continue;
    const list = successors.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    successors.set(from, list);
    hasIncoming.add(to);
  }

  // 1. Columns: breadth-first distance from the entry screens.
  const rank = new Map<string, number>();
  const discovery: string[] = [];
  const roots = [
    ...(options.roots ?? []).filter((id) => known.has(id)),
    ...ids.filter((id) => !hasIncoming.has(id) && successors.has(id)),
    ...ids.filter((id) => successors.has(id) || hasIncoming.has(id)),
  ];
  for (const root of roots) {
    if (rank.has(root)) continue;
    rank.set(root, 0);
    const queue = [root];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]!;
      discovery.push(id);
      for (const next of successors.get(id) ?? []) {
        if (rank.has(next)) continue;
        rank.set(next, rank.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  const isolated = ids.filter((id) => !rank.has(id));

  // 2. Forward edges shape the layout; long ones get a lane in each skipped column.
  const layers: Item[][] = [];
  const at = (column: number) => (layers[column] ??= []);
  for (const id of discovery) at(rank.get(id)!).push({ id, dummy: false, height: options.height });
  const linksDown = new Map<string, string[]>();
  const linksUp = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    linksDown.set(from, [...(linksDown.get(from) ?? []), to]);
    linksUp.set(to, [...(linksUp.get(to) ?? []), from]);
  };
  for (const [from, targets] of successors) {
    for (const to of targets) {
      const start = rank.get(from)!;
      const end = rank.get(to)!;
      if (end <= start) continue;
      let previous = from;
      for (let column = start + 1; column < end; column += 1) {
        const lane = `lane:${from}→${to}:${column}`;
        at(column).push({ id: lane, dummy: true, height: laneHeight });
        link(previous, lane);
        previous = lane;
      }
      link(previous, to);
    }
  }

  // 3. Order each column by the average position of its neighbours.
  const order = new Map<string, number>();
  const renumber = (layer: Item[]) => layer.forEach((item, index) => order.set(item.id, index));
  layers.forEach(renumber);
  const barycenter = (id: string, neighbours: Map<string, string[]>) => {
    const list = neighbours.get(id) ?? [];
    return list.length
      ? list.reduce((sum, other) => sum + (order.get(other) ?? 0), 0) / list.length
      : undefined;
  };
  // Crossings between one pair of neighbouring items, counted against the
  // columns on both sides.
  const pairCrossings = (u: string, v: string) => {
    let count = 0;
    for (const neighbours of [linksUp, linksDown]) {
      for (const a of neighbours.get(u) ?? [])
        for (const b of neighbours.get(v) ?? []) if (order.get(a)! > order.get(b)!) count += 1;
    }
    return count;
  };
  const totalCrossings = () => {
    let count = 0;
    for (const layer of layers.slice(0, -1)) {
      const edges = layer.flatMap((item) =>
        (linksDown.get(item.id) ?? []).map((to) => [order.get(item.id)!, order.get(to)!] as const),
      );
      for (let i = 0; i < edges.length; i += 1)
        for (let j = i + 1; j < edges.length; j += 1) {
          const [a1, b1] = edges[i]!;
          const [a2, b2] = edges[j]!;
          if ((a1 - a2) * (b1 - b2) < 0) count += 1;
        }
    }
    return count;
  };
  // Swap neighbours while that removes crossings (the classic "transpose" step).
  const transpose = () => {
    for (let improved = true, rounds = 0; improved && rounds < 12; rounds += 1) {
      improved = false;
      for (const layer of layers) {
        for (let index = 0; index + 1 < layer.length; index += 1) {
          const u = layer[index]!.id;
          const v = layer[index + 1]!.id;
          if (pairCrossings(u, v) > pairCrossings(v, u)) {
            const swapped = layer[index]!;
            layer[index] = layer[index + 1]!;
            layer[index + 1] = swapped;
            renumber(layer);
            improved = true;
          }
        }
      }
    }
  };
  let best = { crossings: totalCrossings(), layers: layers.map((layer) => [...layer]) };
  for (let sweep = 0; sweep < 16; sweep += 1) {
    const down = sweep % 2 === 0;
    const sequence = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of sequence) {
      const keyed = layer.map((item, index) => ({
        item,
        key: barycenter(item.id, down ? linksUp : linksDown) ?? index,
        index,
      }));
      keyed.sort((a, b) => a.key - b.key || a.index - b.index);
      layer.splice(0, layer.length, ...keyed.map(({ item }) => item));
      renumber(layer);
    }
    transpose();
    const crossings = totalCrossings();
    if (crossings < best.crossings) best = { crossings, layers: layers.map((layer) => [...layer]) };
    if (!crossings) break;
  }
  best.layers.forEach((layer, index) => layers[index]!.splice(0, layers[index]!.length, ...layer));
  layers.forEach(renumber);

  // 4. Vertical placement: centre on neighbours, never overlap, keep order.
  const centre = new Map<string, number>();
  const place = (layer: Item[], desired: (item: Item) => number | undefined) => {
    let cursor = -Infinity;
    const placed = layer.map((item) => {
      const wanted = desired(item);
      const floor = Number.isFinite(cursor) ? cursor : 0;
      const top = Number.isFinite(cursor)
        ? Math.max(wanted === undefined ? floor : wanted - item.height / 2, floor)
        : wanted === undefined
          ? floor
          : wanted - item.height / 2;
      cursor = top + item.height + (item.dummy ? 8 : rowGap);
      return { item, top, wanted };
    });
    // Shift the column so it sits on average where its neighbours want it.
    const deltas = placed.flatMap(({ item, top, wanted }) =>
      wanted === undefined ? [] : [top + item.height / 2 - wanted],
    );
    const shift = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0;
    for (const { item, top } of placed) centre.set(item.id, top - shift + item.height / 2);
  };
  layers.forEach((layer, column) => {
    if (column === 0) {
      let cursor = 0;
      for (const item of layer) {
        centre.set(item.id, cursor + item.height / 2);
        cursor += item.height + rowGap;
      }
      return;
    }
    place(layer, (item) => {
      const parents = linksUp.get(item.id) ?? [];
      const ys = parents.flatMap((parent) => (centre.has(parent) ? [centre.get(parent)!] : []));
      return ys.length ? ys.reduce((sum, y) => sum + y, 0) / ys.length : undefined;
    });
  });

  // Entry screens have nothing to the left; centre them on what they lead to.
  if (layers[0]) {
    place(layers[0], (item) => {
      const children = linksDown.get(item.id) ?? [];
      const ys = children.flatMap((child) => (centre.has(child) ? [centre.get(child)!] : []));
      return ys.length ? ys.reduce((sum, y) => sum + y, 0) / ys.length : undefined;
    });
  }

  // 5. Coordinates. Screens nobody reached by a path sit in a row underneath.
  const columnX = (column: number) => column * (options.width + columnGap);
  const positions = new Map<string, MapPoint>();
  let minY = Infinity;
  let maxY = -Infinity;
  layers.forEach((layer, column) => {
    for (const item of layer) {
      const top = centre.get(item.id)! - item.height / 2;
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, top + item.height);
      if (!item.dummy) positions.set(item.id, { x: columnX(column), y: top });
    }
  });
  if (!Number.isFinite(minY)) minY = maxY = 0;
  for (const point of positions.values()) point.y -= minY;
  const isolatedTop = positions.size ? maxY - minY + rowGap * 2 : 0;
  isolated.forEach((id, index) => positions.set(id, { x: columnX(index), y: isolatedTop }));

  return positions;
}
