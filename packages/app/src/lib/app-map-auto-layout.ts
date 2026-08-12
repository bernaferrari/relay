import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";
import { DEFAULT_CANVAS_GRID_SPACING, snapCanvasPointToGrid } from "./app-map-grid";

type LayoutGraph = {
  screens: readonly { id: string }[];
  flows: readonly { screenId: string }[];
  transitions: readonly {
    fromScreenId: string;
    destination: { kind: string; screenId?: string };
    label?: string;
    /** Recorded interaction evidence is optional for older/planned edges, but
     * when it exists it gives a much better sibling reading order than write
     * order alone. */
    sourceAnchor?: { point?: { x?: number; y?: number } };
    presentation?: { sourcePort?: string };
  }[];
};

type LayoutEdge = { from: string; to: string };
type LayoutBlock = { id: string; screenIds: string[]; order: number };
type ScreenLayoutEdge = LayoutEdge & {
  viewport: boolean;
  order: number;
  sourceScreenId: string;
  /** Normalized ordering coordinate on the source screen. */
  sourceOrder?: number;
};
type OrderedScreenLayoutEdge = ScreenLayoutEdge & { sourceOrder: number };

const CARD_GAP_X = 112;
const CARD_GAP_Y = 48;
const SIBLING_BRANCH_GAP_ROWS = 0.2;
const VIEWPORT_CHAIN_GAP_ROWS = 0.3;
const MAX_LOCAL_LAYOUT_PASSES = 2;
const CANONICAL_LAYOUT_GRID = { spacing: DEFAULT_CANVAS_GRID_SPACING } as const;

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
  const unsortedScreenEdges = graph.transitions.flatMap((transition, transitionIndex) => {
    const to =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
    if (!to || !screenIds.has(transition.fromScreenId) || !screenIds.has(to)) return [];
    return [
      {
        from: transition.fromScreenId,
        to,
        viewport: isViewportTransition(transition.label),
        order: transitionIndex,
        sourceScreenId: transition.fromScreenId,
        sourceOrder: sourceAnchorCoordinate(transition),
      },
    ];
  });
  const screenEdges = withSourceOrders(unsortedScreenEdges);

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
  const edgeSourceOrder = new Map<string, number>();
  const sourceOrderingChoice = new Map<
    string,
    { sourceOffset: number; transitionOrder: number; sourceOrder: number }
  >();
  for (const edge of screenEdges) {
    const from = blockForScreen.get(edge.from);
    const to = blockForScreen.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = edgeKey(from, to);
    edgeOrder.set(key, Math.min(edgeOrder.get(key) ?? Number.MAX_SAFE_INTEGER, edge.order));
    const sourceBlock = blockById.get(from);
    const sourceOffset = sourceBlock?.screenIds.indexOf(edge.sourceScreenId) ?? -1;
    if (sourceOffset >= 0) {
      edgeSourceOffset.set(key, Math.min(edgeSourceOffset.get(key) ?? sourceOffset, sourceOffset));
      const previous = sourceOrderingChoice.get(key);
      if (
        !previous ||
        sourceOffset < previous.sourceOffset ||
        (sourceOffset === previous.sourceOffset && edge.order < previous.transitionOrder)
      ) {
        sourceOrderingChoice.set(key, {
          sourceOffset,
          transitionOrder: edge.order,
          sourceOrder: edge.sourceOrder,
        });
      }
    }
  }
  for (const [key, choice] of sourceOrderingChoice) edgeSourceOrder.set(key, choice.sourceOrder);
  const positions = layoutPrimaryForest(
    orderedLayers,
    blocks,
    blockById,
    dagEdges,
    blockEdges,
    entryBlocks,
    edgeOrder,
    edgeSourceOffset,
    edgeSourceOrder,
  );
  // Auto-layout is a creation path too. It uses the fixed minor lattice—not
  // the zoom-dependent major dots—so tidying a map never creates cards that
  // jump on their first drag or after a zoom change.
  return Object.fromEntries(
    Object.entries(positions).map(([id, point]) => [
      id,
      snapCanvasPointToGrid(point, CANONICAL_LAYOUT_GRID),
    ]),
  );
}

function sourceAnchorCoordinate(
  transition: LayoutGraph["transitions"][number],
): number | undefined {
  const point = transition.sourceAnchor?.point;
  const coordinate =
    transition.presentation?.sourcePort === "top" ||
    transition.presentation?.sourcePort === "bottom"
      ? point?.x
      : point?.y;
  if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) return undefined;
  return Math.min(1, Math.max(0, coordinate));
}

/**
 * Branches recorded from one screen should read in the same order as the
 * controls a person saw on that screen. An unanchored/planned edge receives
 * the position it would have had in stable transition order, so older maps
 * retain their existing layout rather than gaining a new arbitrary order.
 */
function withSourceOrders(edges: readonly ScreenLayoutEdge[]): OrderedScreenLayoutEdge[] {
  const bySource = new Map<string, ScreenLayoutEdge[]>();
  for (const edge of edges) {
    bySource.set(edge.sourceScreenId, [...(bySource.get(edge.sourceScreenId) ?? []), edge]);
  }
  const orders = new Map<number, number>();
  for (const sourceEdges of bySource.values()) {
    const ordered = [...sourceEdges].sort((left, right) => left.order - right.order);
    const count = ordered.length;
    for (const [index, edge] of ordered.entries()) {
      const fallback = (index + 0.5) / count;
      orders.set(edge.order, edge.sourceOrder ?? fallback);
    }
  }
  return edges.map((edge) => ({ ...edge, sourceOrder: orders.get(edge.order) ?? 0.5 }));
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
  scoreEdges: readonly LayoutEdge[],
  entries: readonly string[],
  edgeOrder: ReadonlyMap<string, number>,
  edgeSourceOffset: ReadonlyMap<string, number>,
  edgeSourceOrder: ReadonlyMap<string, number>,
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
  const outgoing = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  const parent = new Map<string, string>();
  for (const block of blocks) {
    const candidates = [...(incoming.get(block.id) ?? [])].sort((left, right) => {
      const rankDelta = (rank.get(right.from) ?? 0) - (rank.get(left.from) ?? 0);
      if (rankDelta) return rankDelta;
      // A direct continuation is the least surprising owner for a screen when
      // a graph has a same-rank cross-link. It keeps an account → edit → dialog
      // chain on one row while still retaining every additional graph edge.
      const continuationDelta =
        Number((outgoing.get(left.from)?.length ?? 0) !== 1) -
        Number((outgoing.get(right.from)?.length ?? 0) !== 1);
      if (continuationDelta) return continuationDelta;
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
      const anchorDelta =
        (edgeSourceOrder.get(edgeKey(parentId, left)) ?? 0.5) -
        (edgeSourceOrder.get(edgeKey(parentId, right)) ?? 0.5);
      if (anchorDelta) return anchorDelta;
      const edgeDelta =
        (edgeOrder.get(edgeKey(parentId, left)) ?? Number.MAX_SAFE_INTEGER) -
        (edgeOrder.get(edgeKey(parentId, right)) ?? Number.MAX_SAFE_INTEGER);
      return edgeDelta || (lane.get(left) ?? 0) - (lane.get(right) ?? 0);
    });
  }

  const roots = blocks.filter((block) => !parent.has(block.id)).map((block) => block.id);
  roots.sort((left, right) => {
    const entryDelta = Number(!entries.includes(left)) - Number(!entries.includes(right));
    return entryDelta || (lane.get(left) ?? 0) - (lane.get(right) ?? 0);
  });

  const initialChildren = cloneLayoutChildren(children);
  let selectedChildren = children;
  let positions = layoutForestPositions({
    roots,
    blockById,
    children: selectedChildren,
    edgeSourceOffset,
  });
  let bestCost = layoutCost(positions, scoreEdges, initialChildren, selectedChildren);

  // Layout as a graph, not only a tree: a child whose branch is made primary
  // can sometimes remove several cross-links or long elbow detours. We test
  // the small, stable set of first-slot alternatives locally. The objective is
  // lexicographic: crossings, then orthogonal-route burden, then minimal
  // departure from the authored/source order. Direct single-child chains have
  // no alternative, so they stay exactly on their parent row.
  const parentIds = [...children.keys()].sort((left, right) => {
    const orderDelta = (blockById.get(left)?.order ?? 0) - (blockById.get(right)?.order ?? 0);
    return orderDelta || left.localeCompare(right);
  });
  for (let pass = 0; pass < MAX_LOCAL_LAYOUT_PASSES; pass += 1) {
    let changed = false;
    for (const parentId of parentIds) {
      const childIds = selectedChildren.get(parentId) ?? [];
      if (childIds.length < 2) continue;
      let candidateChildren = selectedChildren;
      let candidatePositions = positions;
      let candidateCost = bestCost;
      for (let index = 1; index < childIds.length; index += 1) {
        const alternative = moveChildToPrimarySlot(selectedChildren, parentId, index);
        const alternativePositions = layoutForestPositions({
          roots,
          blockById,
          children: alternative,
          edgeSourceOffset,
        });
        const alternativeCost = layoutCost(
          alternativePositions,
          scoreEdges,
          initialChildren,
          alternative,
        );
        if (compareLayoutCost(alternativeCost, candidateCost) < 0) {
          candidateChildren = alternative;
          candidatePositions = alternativePositions;
          candidateCost = alternativeCost;
        }
      }
      if (candidateChildren !== selectedChildren) {
        selectedChildren = candidateChildren;
        positions = candidatePositions;
        bestCost = candidateCost;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return positions;
}

type LayoutCost = {
  crossings: number;
  bends: number;
  routeDistance: number;
  siblingMovement: number;
};

function layoutForestPositions(input: {
  roots: readonly string[];
  blockById: ReadonlyMap<string, LayoutBlock>;
  children: ReadonlyMap<string, readonly string[]>;
  edgeSourceOffset: ReadonlyMap<string, number>;
}): Record<string, CanvasPoint> {
  const { roots, blockById, children, edgeSourceOffset } = input;
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

function cloneLayoutChildren(
  children: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  return new Map([...children].map(([parentId, childIds]) => [parentId, [...childIds]]));
}

function moveChildToPrimarySlot(
  children: ReadonlyMap<string, readonly string[]>,
  parentId: string,
  childIndex: number,
): Map<string, string[]> {
  const current = children.get(parentId) ?? [];
  const childId = current[childIndex];
  if (!childId) return cloneLayoutChildren(children);
  const next = cloneLayoutChildren(children);
  next.set(parentId, [childId, ...current.filter((_, index) => index !== childIndex)]);
  return next;
}

function layoutCost(
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
      edge.points.slice(1).reduce(
        (distance, point, index) =>
          distance +
          Math.abs(point.x - edge.points[index]!.x) +
          Math.abs(point.y - edge.points[index]!.y),
        0,
      ),
    0,
  );
  const bends = drawableEdges.reduce((total, edge) => total + Math.max(0, edge.points.length - 2), 0);
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

function compareLayoutCost(left: LayoutCost, right: LayoutCost): number {
  return (
    left.crossings - right.crossings ||
    left.bends - right.bends ||
    left.routeDistance - right.routeDistance ||
    left.siblingMovement - right.siblingMovement
  );
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
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  );
}

function layoutChildrenBySource(
  blockId: string,
  sourceCount: number,
  children: ReadonlyMap<string, readonly string[]>,
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
