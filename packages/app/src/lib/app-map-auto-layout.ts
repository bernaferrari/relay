import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";

type LayoutGraph = {
  screens: readonly { id: string }[];
  flows: readonly { screenId: string }[];
  transitions: readonly {
    fromScreenId: string;
    destination: { kind: string; screenId?: string };
    label?: string;
  }[];
};

type LayoutEdge = { from: string; to: string };
type LayoutBlock = { id: string; screenIds: string[]; order: number };

const CARD_GAP_X = 112;
const CARD_GAP_Y = 48;
const SIBLING_BRANCH_GAP_ROWS = 0.2;
const VIEWPORT_CHAIN_GAP_ROWS = 0.3;

/**
 * Tidy-tree layout for the real screen graph.
 *
 * Viewport-only transitions are collapsed into tall atomic blocks before the
 * graph is ranked. That keeps scroll captures together without creating a
 * second, incompatible layout. Back edges are excluded only from ranking, not
 * from the saved graph or renderer. A primary parent is then chosen for every
 * screen so siblings can be packed into contiguous, non-overlapping branches.
 */
export function compactCanvasPositions(graph: LayoutGraph): Record<string, CanvasPoint> {
  if (!graph.screens.length) return {};

  const screenOrder = new Map(graph.screens.map((screen, index) => [screen.id, index]));
  const screenIds = new Set(screenOrder.keys());
  const entryIds = graph.flows.map((flow) => flow.screenId).filter((id) => screenIds.has(id));
  const screenEdges = graph.transitions.flatMap((transition, transitionIndex) => {
    const to =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
    if (!to || !screenIds.has(transition.fromScreenId) || !screenIds.has(to)) return [];
    return [
      {
        from: transition.fromScreenId,
        to,
        viewport: isViewportTransition(transition.label),
        order: transitionIndex,
      },
    ];
  });

  const blocks = buildLayoutBlocks([...screenIds], screenEdges, screenOrder, entryIds);
  const blockForScreen = new Map<string, string>();
  for (const block of blocks) {
    for (const screenId of block.screenIds) blockForScreen.set(screenId, block.id);
  }
  const blockEdges = uniqueEdges(
    screenEdges.flatMap((edge) => {
      const from = blockForScreen.get(edge.from);
      const to = blockForScreen.get(edge.to);
      return !from || !to || from === to ? [] : [{ from, to }];
    }),
  );
  const entryBlocks = [
    ...new Set(entryIds.flatMap((screenId) => blockForScreen.get(screenId) ?? [])),
  ];
  const blockOrder = new Map(blocks.map((block) => [block.id, block.order]));
  const dagEdges = acyclicRankingEdges(
    blocks.map((block) => block.id),
    blockEdges,
    blockOrder,
    entryBlocks,
  );
  const layers = rankedLayers(
    blocks.map((block) => block.id),
    dagEdges,
    blockOrder,
  );
  const orderedLayers = orderLayers(layers, dagEdges, blockOrder);
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const edgeOrder = new Map<string, number>();
  const edgeSourceOffset = new Map<string, number>();
  for (const edge of screenEdges) {
    const from = blockForScreen.get(edge.from);
    const to = blockForScreen.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = edgeKey(from, to);
    edgeOrder.set(key, Math.min(edgeOrder.get(key) ?? Number.MAX_SAFE_INTEGER, edge.order));
    const sourceBlock = blockById.get(from);
    const sourceOffset = sourceBlock?.screenIds.indexOf(edge.from) ?? -1;
    if (sourceOffset >= 0) {
      edgeSourceOffset.set(key, Math.min(edgeSourceOffset.get(key) ?? sourceOffset, sourceOffset));
    }
  }
  return layoutPrimaryForest(
    orderedLayers,
    blocks,
    blockById,
    dagEdges,
    entryBlocks,
    edgeOrder,
    edgeSourceOffset,
  );
}

function buildLayoutBlocks(
  screenIds: readonly string[],
  edges: readonly (LayoutEdge & { viewport: boolean })[],
  order: ReadonlyMap<string, number>,
  entryIds: readonly string[],
): LayoutBlock[] {
  const viewportEdges = edges.filter((edge) => edge.viewport);
  const next = new Map<string, string>();
  const incoming = new Map<string, number>();
  for (const edge of viewportEdges) {
    if (next.has(edge.from)) continue;
    next.set(edge.from, edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const visited = new Set<string>();
  const starts = [
    ...entryIds,
    ...screenIds.filter((id) => next.has(id) && !incoming.has(id)),
    ...screenIds,
  ];
  const blocks: LayoutBlock[] = [];
  for (const start of starts) {
    if (visited.has(start)) continue;
    const chain: string[] = [];
    const local = new Set<string>();
    let current: string | undefined = start;
    while (current && !visited.has(current) && !local.has(current)) {
      chain.push(current);
      visited.add(current);
      local.add(current);
      const candidate = next.get(current);
      current = candidate && (incoming.get(candidate) ?? 0) <= 1 ? candidate : undefined;
    }
    const firstOrder = Math.min(...chain.map((id) => order.get(id) ?? Number.MAX_SAFE_INTEGER));
    blocks.push({ id: chain[0]!, screenIds: chain, order: firstOrder });
  }
  return blocks;
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

function uniqueEdges(edges: readonly LayoutEdge[]): LayoutEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = edgeKey(edge.from, edge.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A screen map is primarily a navigation tree even when the saved model is a
 * graph. Assigning one layout parent lets every branch reserve the complete
 * height of its descendants. Primary paths therefore cannot cross; extra
 * graph relationships remain visible but never dictate chaotic placement.
 */
function layoutPrimaryForest(
  layers: readonly string[][],
  blocks: readonly LayoutBlock[],
  blockById: ReadonlyMap<string, LayoutBlock>,
  edges: readonly LayoutEdge[],
  entries: readonly string[],
  edgeOrder: ReadonlyMap<string, number>,
  edgeSourceOffset: ReadonlyMap<string, number>,
): Record<string, CanvasPoint> {
  const rank = new Map<string, number>();
  const lane = new Map<string, number>();
  layers.forEach((layer, layerIndex) =>
    layer.forEach((id, laneIndex) => {
      rank.set(id, layerIndex);
      lane.set(id, laneIndex);
    }),
  );
  const incoming = new Map<string, LayoutEdge[]>();
  for (const edge of edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  const parent = new Map<string, string>();
  for (const block of blocks) {
    const candidates = [...(incoming.get(block.id) ?? [])].sort((left, right) => {
      const rankDelta = (rank.get(right.from) ?? 0) - (rank.get(left.from) ?? 0);
      if (rankDelta) return rankDelta;
      const edgeDelta =
        (edgeOrder.get(edgeKey(left.from, left.to)) ?? Number.MAX_SAFE_INTEGER) -
        (edgeOrder.get(edgeKey(right.from, right.to)) ?? Number.MAX_SAFE_INTEGER);
      return edgeDelta || (lane.get(left.from) ?? 0) - (lane.get(right.from) ?? 0);
    });
    if (candidates[0]) parent.set(block.id, candidates[0].from);
  }

  const children = new Map<string, string[]>();
  for (const [child, parentId] of parent) {
    children.set(parentId, [...(children.get(parentId) ?? []), child]);
  }
  for (const [parentId, childIds] of children) {
    childIds.sort((left, right) => {
      const sourceDelta =
        (edgeSourceOffset.get(edgeKey(parentId, left)) ?? 0) -
        (edgeSourceOffset.get(edgeKey(parentId, right)) ?? 0);
      if (sourceDelta) return sourceDelta;
      const edgeDelta =
        (edgeOrder.get(edgeKey(parentId, left)) ?? Number.MAX_SAFE_INTEGER) -
        (edgeOrder.get(edgeKey(parentId, right)) ?? Number.MAX_SAFE_INTEGER);
      return edgeDelta || (lane.get(left) ?? 0) - (lane.get(right) ?? 0);
    });
  }

  const rowsMemo = new Map<string, number>();
  const subtreeRows = (id: string): number => {
    const cached = rowsMemo.get(id);
    if (cached !== undefined) return cached;
    const ownCount = blockById.get(id)?.screenIds.length ?? 1;
    const childrenBySource = layoutChildrenBySource(id, ownCount, children, edgeSourceOffset);
    let rows = 0;
    for (let sourceIndex = 0; sourceIndex < ownCount; sourceIndex += 1) {
      const branchRows = (childrenBySource[sourceIndex] ?? []).reduce(
        (sum, childId) => sum + subtreeRows(childId),
        0,
      );
      const siblingCount = childrenBySource[sourceIndex]?.length ?? 0;
      const siblingGaps = Math.max(0, siblingCount - 1) * SIBLING_BRANCH_GAP_ROWS;
      rows += Math.max(1, branchRows + siblingGaps);
      if (sourceIndex < ownCount - 1) rows += VIEWPORT_CHAIN_GAP_ROWS;
    }
    rowsMemo.set(id, rows);
    return rows;
  };

  const roots = blocks.filter((block) => !parent.has(block.id)).map((block) => block.id);
  roots.sort((left, right) => {
    const entryDelta = Number(!entries.includes(left)) - Number(!entries.includes(right));
    return entryDelta || (lane.get(left) ?? 0) - (lane.get(right) ?? 0);
  });
  const positions: Record<string, CanvasPoint> = {};
  const pitchX = SCREEN_CARD_WIDTH + CARD_GAP_X;
  const pitchY = SCREEN_CARD_HEIGHT + CARD_GAP_Y;
  const place = (id: string, depth: number, topRow: number) => {
    const block = blockById.get(id)!;
    const childrenBySource = layoutChildrenBySource(
      id,
      block.screenIds.length,
      children,
      edgeSourceOffset,
    );
    let sectionTop = topRow;
    block.screenIds.forEach((screenId, sourceIndex) => {
      positions[screenId] = {
        x: depth * pitchX,
        y: sectionTop * pitchY,
      };
      let childTop = sectionTop;
      const sourceChildren = childrenBySource[sourceIndex] ?? [];
      sourceChildren.forEach((childId, childIndex) => {
        place(childId, depth + 1, childTop);
        childTop += subtreeRows(childId);
        if (childIndex < sourceChildren.length - 1) childTop += SIBLING_BRANCH_GAP_ROWS;
      });
      sectionTop = Math.max(sectionTop + 1, childTop);
      if (sourceIndex < block.screenIds.length - 1) sectionTop += VIEWPORT_CHAIN_GAP_ROWS;
    });
  };
  let rootTop = 0;
  roots.forEach((root, index) => {
    if (index) rootTop += 1;
    place(root, 0, rootTop);
    rootTop += subtreeRows(root);
  });
  return positions;
}

function layoutChildrenBySource(
  blockId: string,
  sourceCount: number,
  children: ReadonlyMap<string, string[]>,
  edgeSourceOffset: ReadonlyMap<string, number>,
): string[][] {
  const grouped = Array.from({ length: sourceCount }, () => [] as string[]);
  for (const childId of children.get(blockId) ?? []) {
    const sourceIndex = Math.max(
      0,
      Math.min(sourceCount - 1, edgeSourceOffset.get(edgeKey(blockId, childId)) ?? 0),
    );
    grouped[sourceIndex]!.push(childId);
  }
  return grouped;
}

/** DFS back edges are the only edges removed from ranking. This turns cycles
 * into short return paths instead of inflating every node to the maximum rank. */
function acyclicRankingEdges(
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

function rankedLayers(
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
function orderLayers(
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

function isViewportTransition(label: string | undefined): boolean {
  return /\b(?:scroll|swipe)\b/i.test(label ?? "");
}
