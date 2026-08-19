/**
 * The ranking half of the tidy layout: which column a screen belongs in, and in
 * what order the screens inside one column are read.
 *
 * This is the Sugiyama method's first two phases — make the graph acyclic,
 * assign layers, then reduce crossings with barycentric sweeps — kept apart
 * from the placement pass that turns layers into canvas coordinates.
 */
export type LayoutEdge = { from: string; to: string };

export function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

export function uniqueEdges(edges: readonly LayoutEdge[]): LayoutEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = edgeKey(edge.from, edge.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** DFS back edges are the only edges removed from ranking. This turns cycles
 * into short return paths instead of inflating every node to the maximum rank. */
export function acyclicRankingEdges(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  order: ReadonlyMap<string, number>,
  entries: readonly string[],
): LayoutEdge[] {
  const outgoing = new Map<string, LayoutEdge[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  for (const values of outgoing.values()) {
    values.sort((left, right) => (order.get(left.to) ?? 0) - (order.get(right.to) ?? 0));
  }
  const state = new Map<string, "visiting" | "visited">();
  const kept: LayoutEdge[] = [];
  const visit = (id: string) => {
    if (state.has(id)) return;
    state.set(id, "visiting");
    for (const edge of outgoing.get(id) ?? []) {
      if (state.get(edge.to) === "visiting") continue;
      kept.push(edge);
      visit(edge.to);
    }
    state.set(id, "visited");
  };
  const roots = [...new Set([...entries, ...ids])];
  roots.sort((left, right) => {
    const entryDelta = Number(!entries.includes(left)) - Number(!entries.includes(right));
    return entryDelta || (order.get(left) ?? 0) - (order.get(right) ?? 0);
  });
  roots.forEach(visit);
  return uniqueEdges(kept);
}

export function rankedLayers(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  order: ReadonlyMap<string, number>,
): string[][] {
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  const ready = ids.filter((id) => incoming.get(id) === 0);
  ready.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const rank = new Map(ids.map((id) => [id, 0]));
  while (ready.length) {
    const id = ready.shift()!;
    for (const edge of outgoing.get(id) ?? []) {
      rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, (rank.get(id) ?? 0) + 1));
      incoming.set(edge.to, (incoming.get(edge.to) ?? 1) - 1);
      if (incoming.get(edge.to) === 0) {
        ready.push(edge.to);
        ready.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      }
    }
  }
  const layers: string[][] = [];
  for (const id of ids) (layers[rank.get(id) ?? 0] ??= []).push(id);
  for (const layer of layers) layer.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return layers.filter((layer) => layer.length);
}

/** Alternating barycentric sweeps are the crossing-reduction phase of the
 * Sugiyama method. They preserve deterministic source order for ties. */
export function orderLayers(
  input: readonly string[][],
  edges: readonly LayoutEdge[],
  order: ReadonlyMap<string, number>,
): string[][] {
  const layers = input.map((layer) => [...layer]);
  const sortLayer = (layerIndex: number, incoming: boolean) => {
    const positions = new Map<string, number>();
    layers.forEach((layer) => layer.forEach((id, index) => positions.set(id, index)));
    const neighbors = new Map<string, number[]>();
    for (const edge of edges) {
      const id = incoming ? edge.to : edge.from;
      const neighbor = incoming ? edge.from : edge.to;
      if (!layers[layerIndex]?.includes(id)) continue;
      const position = positions.get(neighbor);
      if (position !== undefined) neighbors.set(id, [...(neighbors.get(id) ?? []), position]);
    }
    layers[layerIndex]!.sort((left, right) => {
      const leftValues = neighbors.get(left);
      const rightValues = neighbors.get(right);
      const barycenter = (values: number[] | undefined) =>
        values?.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
      const a = barycenter(leftValues);
      const b = barycenter(rightValues);
      if (a !== undefined && b !== undefined && a !== b) return a - b;
      if (a !== undefined) return -1;
      if (b !== undefined) return 1;
      return (order.get(left) ?? 0) - (order.get(right) ?? 0);
    });
  };
  for (let pass = 0; pass < 8; pass += 1) {
    for (let rank = 1; rank < layers.length; rank += 1) sortLayer(rank, true);
    for (let rank = layers.length - 2; rank >= 0; rank -= 1) sortLayer(rank, false);
  }
  return layers;
}
