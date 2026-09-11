export type LayoutPoint = { x: number; y: number };
export type LayoutEdge = { from: string; to: string };
type Tree = {
  points: Map<string, LayoutPoint>;
  contours: Map<number, { min: number; max: number }>;
};

/** Compact discovery trees by comparing occupied rows at each depth, not whole subtree boxes. */
export function layoutMapGraph(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  columnGap: number,
  rowGap: number,
): Map<string, LayoutPoint> {
  const known = new Set(ids);
  const children = new Map<string, string[]>();
  const incoming = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) continue;
    const targets = adjacency.get(edge.from) ?? [];
    if (!targets.includes(edge.to)) targets.push(edge.to);
    adjacency.set(edge.from, targets);
    incoming.add(edge.to);
  }
  const visited = new Set<string>();
  const roots: string[] = [];
  for (const id of [...ids.filter((id) => !incoming.has(id)), ...ids]) {
    if (visited.has(id)) continue;
    roots.push(id);
    visited.add(id);
    const queue = [id];
    for (let i = 0; i < queue.length; i++) {
      const parent = queue[i]!;
      for (const child of adjacency.get(parent) ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        children.set(parent, [...(children.get(parent) ?? []), child]);
        queue.push(child);
      }
    }
  }
  function build(id: string): Tree {
    const points = new Map<string, LayoutPoint>();
    const contours = new Map<number, { min: number; max: number }>();
    const childRows: number[] = [];
    for (const child of children.get(id) ?? []) {
      const tree = build(child);
      let shift = 0;
      for (const [depth, range] of tree.contours) {
        const previous = contours.get(depth + 1);
        if (previous) shift = Math.max(shift, previous.max + rowGap - range.min);
      }
      childRows.push(shift);
      for (const [key, point] of tree.points)
        points.set(key, { x: point.x + columnGap, y: point.y + shift });
      for (const [depth, range] of tree.contours) {
        const previous = contours.get(depth + 1);
        contours.set(depth + 1, {
          min: Math.min(previous?.min ?? Infinity, range.min + shift),
          max: Math.max(previous?.max ?? -Infinity, range.max + shift),
        });
      }
    }
    // A single continuation remains straight; a branch centers on its middle child.
    const parentRow = childRows[Math.floor((childRows.length - 1) / 2)] ?? 0;
    for (const point of points.values()) point.y -= parentRow;
    for (const range of contours.values()) {
      range.min -= parentRow;
      range.max -= parentRow;
    }
    points.set(id, { x: 0, y: 0 });
    contours.set(0, { min: 0, max: 0 });
    return { points, contours };
  }
  const result = new Map<string, LayoutPoint>();
  let nextRow = 0;
  for (const root of roots) {
    const tree = build(root);
    const ys = [...tree.points.values()].map((point) => point.y);
    const min = Math.min(...ys),
      max = Math.max(...ys);
    for (const [id, point] of tree.points)
      result.set(id, { x: point.x, y: point.y - min + nextRow });
    nextRow += max - min + rowGap * 1.5;
  }
  return result;
}
