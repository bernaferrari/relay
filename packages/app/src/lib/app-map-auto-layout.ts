import { compareLayoutCost, layoutCost, type LayoutCost } from "./app-map-auto-layout-cost";
import {
  acyclicRankingEdges,
  edgeKey,
  orderLayers,
  rankedLayers,
  uniqueEdges,
  type LayoutEdge,
} from "./app-map-auto-layout-ranking";
import {
  groupColumns,
  groupRows,
  siblingLayoutGroups,
  SHELF_ROW_GAP_ROWS,
  type ShelfWidth,
  type SiblingGroup,
} from "./app-map-auto-layout-shelves";
import {
  CARD_PITCH_X,
  CARD_PITCH_Y,
  pointInDisplayedFrame,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasPoint,
  type CanvasScreenRotation,
} from "./app-map-canvas-layout";
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
    sourceAnchor?: {
      point?: { x?: number; y?: number };
      /** The captured control bounds are a better reading-order signal than
       * an arbitrary tap inside the control. */
      rect?: { x?: number; y?: number; width?: number; height?: number };
    };
    presentation?: { sourcePort?: string };
  }[];
};

/** Presentation-only inputs for a layout pass. Keeping this outside the
 * canonical App Map means a renderer can account for the orientation it is
 * actually displaying without turning a temporary image transform into shared
 * executable document state. */
export type CompactCanvasLayoutOptions = Readonly<{
  sourceRotationFor?: (screenId: string) => CanvasScreenRotation | undefined;
}>;

type LayoutBlock = { id: string; screenIds: string[]; order: number };
type ScreenLayoutEdge = LayoutEdge & {
  viewport: boolean;
  order: number;
  sourceScreenId: string;
  /** Normalized ordering coordinate on the source screen. */
  sourceOrder?: number;
  /** A recorded control position is an authored visual ordering constraint. */
  hasRecordedSourceOrder: boolean;
};
type OrderedScreenLayoutEdge = ScreenLayoutEdge & { sourceOrder: number };

const SIBLING_BRANCH_GAP_ROWS = 0.2;
const VIEWPORT_CHAIN_GAP_ROWS = 0.3;
const MAX_LOCAL_LAYOUT_PASSES = 2;
/**
 * How far one promotion may move siblings out of the order they were recorded
 * in, when all it buys is straighter edges.
 *
 * One inversion is two siblings swapping places: the smallest disagreement an
 * arrangement can have with the order somebody walked the app in, and worth a
 * corner or two, because the pair still reads as the same list. Five is one
 * parent's five children read almost backwards, and no amount of tidying edges
 * is worth telling that story. A crossing is exempt — it is the one thing a
 * reader cannot resolve by looking closer, so it may always be bought.
 */
const SIBLING_MOVEMENT_BUDGET = 1;
/**
 * How wide a shelf row grows before it wraps.
 *
 * Seven is roughly the reach of a path: it keeps a fan from being the thing
 * that sets the map's width while letting it wrap like text rather than stack
 * like a ribbon. It is what every branch is arranged against, so that the
 * arrangement a map gets does not depend on how its shelves happened to wrap.
 */
const DEFAULT_SHELF_COLUMNS = 7;
/**
 * The widths the settled arrangement is then re-flowed at, and the proportion
 * the map is read in.
 *
 * One fixed wrap is wrong in both directions. It leaves a 41-screen crawl still
 * taller than the pane it is read in, spending rows the pane was giving away
 * for free; and it lets a five-screen map lie out in a single strip seven wide,
 * so the map is now width-bound and reads smaller than the same five screens
 * would three across. A per-shelf aspect target was tried and measured worse,
 * because it makes each block square rather than making the map fit — a shelf
 * is only ever read inside the map it belongs to. So the width is chosen for
 * the whole map: the candidate that leaves the map closest to the shape of the
 * pane. Only the pane's proportion is needed, never its size — fit is
 * `min(paneW/w, paneH/h)`, so the arrangement minimizing `max(w / aspect, h)`
 * arrives largest at any pane of that shape.
 */
const SHELF_COLUMN_CHOICES = [3, 4, 5, 6, DEFAULT_SHELF_COLUMNS, 8, 9, 10] as const;
const READING_PANE_ASPECT = 2;
/** Air between two roots. Nothing joins them, so the gap is the only thing
 * saying so. */
const ROOT_BAND_GAP_ROWS = 1;
/** Air between the last path and the band of screens that have no path yet. */
const LOOSE_BAND_GAP_ROWS = 1.5;
/** How wide the loose band grows before it wraps when the journeys are narrow. */
const MIN_LOOSE_BAND_COLUMNS = 4;
/**
 * How tall a root may be and still share a band with another root: two rows of
 * content and the gap between them.
 *
 * A root taller than that is a path to be read down its own rows, and two of
 * those side by side line their rows up with each other and read as one tree,
 * which is exactly the thing this layout exists to prevent. Below it a root is a
 * side path — a couple of screens the crawl reached from a state it never found
 * a way back into — and a full-width band of its own is almost entirely empty
 * canvas.
 */
const MAX_SIDE_PATH_ROWS = 2 + SIBLING_BRANCH_GAP_ROWS;
/** Empty column between two side paths sharing a band. Packed flush, the last
 * card of one and the first card of the next would sit exactly one parent→child
 * gap apart and read as an edge nobody recorded. */
const SIDE_PATH_GUTTER_COLUMNS = 1;
const CANONICAL_LAYOUT_GRID = { spacing: DEFAULT_CANVAS_GRID_SPACING } as const;

/**
 * Tidy-tree layout for the real screen graph.
 *
 * Viewport-only transitions are collapsed into tall atomic blocks before the
 * graph is ranked. That keeps scroll captures together without creating a
 * second, incompatible layout. Back edges are excluded only from ranking, not
 * from the saved graph or renderer. A primary parent is then chosen for every
 * screen so siblings can be packed into contiguous, non-overlapping branches,
 * and a wide fan of screens that open nothing else is packed side by side
 * instead of spending one row each.
 */
export function compactCanvasPositions(
  graph: LayoutGraph,
  options: CompactCanvasLayoutOptions = {},
): Record<string, CanvasPoint> {
  if (!graph.screens.length) return {};

  const screenOrder = new Map(graph.screens.map((screen, index) => [screen.id, index]));
  const screenIds = new Set(screenOrder.keys());
  const entryIds = graph.flows.map((flow) => flow.screenId).filter((id) => screenIds.has(id));
  const unsortedScreenEdges = graph.transitions.flatMap((transition, transitionIndex) => {
    const to =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
    if (!to || !screenIds.has(transition.fromScreenId) || !screenIds.has(to)) return [];
    const sourceRotation = options.sourceRotationFor?.(transition.fromScreenId);
    const sourceOrder = sourceAnchorCoordinate(transition, sourceRotation);
    return [
      {
        from: transition.fromScreenId,
        to,
        viewport: isViewportTransition(transition.label),
        order: transitionIndex,
        sourceScreenId: transition.fromScreenId,
        sourceOrder,
        hasRecordedSourceOrder: sourceOrder !== undefined,
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
  const edgeHasRecordedSourceOrder = new Map<string, boolean>();
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
    edgeHasRecordedSourceOrder.set(
      key,
      Boolean(edgeHasRecordedSourceOrder.get(key) || edge.hasRecordedSourceOrder),
    );
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
    edgeHasRecordedSourceOrder,
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
  sourceRotation?: CanvasScreenRotation,
): number | undefined {
  const point = displayedSourceAnchorPoint(transition, sourceRotation);
  const coordinate =
    transition.presentation?.sourcePort === "top" ||
    transition.presentation?.sourcePort === "bottom"
      ? point?.x
      : point?.y;
  if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) return undefined;
  return Math.min(1, Math.max(0, coordinate));
}

/**
 * Preserve the visible control order even when an interaction was recorded
 * near one edge of a large control. The rect centre represents the control a
 * person sees; the raw point remains the fallback for point-only evidence.
 *
 * This is deliberately shared with the renderer's orientation transform. A
 * landscape iPad frame that is displayed rotated must not make a visually
 * upper control lay out below a visually lower one.
 */
function displayedSourceAnchorPoint(
  transition: LayoutGraph["transitions"][number],
  sourceRotation?: CanvasScreenRotation,
): CanvasPoint | undefined {
  const anchor = transition.sourceAnchor;
  const rect = anchor?.rect;
  const rectCenter =
    rect &&
    [rect.x, rect.y, rect.width, rect.height].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) &&
    rect.width! > 0 &&
    rect.height! > 0
      ? { x: rect.x! + rect.width! / 2, y: rect.y! + rect.height! / 2 }
      : undefined;
  const point = rectCenter ?? anchor?.point;
  if (
    typeof point?.x !== "number" ||
    !Number.isFinite(point.x) ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.y)
  ) {
    return undefined;
  }
  return pointInDisplayedFrame(
    {
      x: Math.min(1, Math.max(0, point.x)),
      y: Math.min(1, Math.max(0, point.y)),
    },
    sourceRotation ?? "none",
  );
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

/** Whether an alternative arrangement stays inside what a straighter edge is
 * allowed to pay for in recorded order. Removing a crossing has no budget. */
function withinSiblingMovementBudget(alternative: LayoutCost, current: LayoutCost): boolean {
  if (alternative.crossings < current.crossings) return true;
  return alternative.siblingMovement - current.siblingMovement <= SIBLING_MOVEMENT_BUDGET;
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
  edgeHasRecordedSourceOrder: ReadonlyMap<string, boolean>,
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

  // A screen with no edge at all is not the head of a path; it is a capture
  // waiting for one. Knowing which blocks the graph actually joins lets the
  // forest keep its vertical space for paths.
  const linked = new Set(scoreEdges.flatMap((edge) => [edge.from, edge.to]));

  const initialChildren = cloneLayoutChildren(children);
  let selectedChildren = children;
  const layoutAt = (childrenAt: ReadonlyMap<string, readonly string[]>, shelfColumns: number) =>
    layoutForestPositions({
      roots,
      blockById,
      children: childrenAt,
      edgeSourceOffset,
      linked,
      entries,
      shelfColumns,
    });
  let positions = layoutAt(selectedChildren, DEFAULT_SHELF_COLUMNS);
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
      // A captured control position is the user's reading order. Route
      // optimization may improve the placement of older, unanchored graphs,
      // but it must never make a later tap appear before an earlier one.
      if (childIds.some((childId) => edgeHasRecordedSourceOrder.get(edgeKey(parentId, childId)))) {
        continue;
      }
      let candidateChildren = selectedChildren;
      let candidatePositions = positions;
      let candidateCost = bestCost;
      for (let index = 1; index < childIds.length; index += 1) {
        const alternative = moveChildToPrimarySlot(selectedChildren, parentId, index);
        const alternativePositions = layoutAt(alternative, DEFAULT_SHELF_COLUMNS);
        const alternativeCost = layoutCost(
          alternativePositions,
          scoreEdges,
          initialChildren,
          alternative,
        );
        if (
          withinSiblingMovementBudget(alternativeCost, candidateCost) &&
          compareLayoutCost(alternativeCost, candidateCost) < 0
        ) {
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
  // Which branch owns which row is settled; how wide the shelves on those rows
  // wrap is not. Choosing it here, against the arrangement that won, means a
  // wider shelf can only re-flow rows into each other — it cannot hand the
  // step above a cheaper route and quietly swap two siblings to reach it.
  return SHELF_COLUMN_CHOICES.map((columns) => layoutAt(selectedChildren, columns)).reduce(
    (best, candidate) =>
      compareReadingShape(readingShape(candidate), readingShape(best)) < 0 ? candidate : best,
  );
}

function layoutForestPositions(input: {
  roots: readonly string[];
  blockById: ReadonlyMap<string, LayoutBlock>;
  children: ReadonlyMap<string, readonly string[]>;
  edgeSourceOffset: ReadonlyMap<string, number>;
  /** Blocks the graph joins to something. Everything else is a loose capture. */
  linked: ReadonlySet<string>;
  /** Declared flow starts. A path somebody named begins the map however
   * short it is, so it is never packed away as a side path. */
  entries: readonly string[];
  /** How wide a shelf row grows before it wraps, chosen for this whole map. */
  shelfColumns: number;
}): Record<string, CanvasPoint> {
  const { roots, blockById, children, edgeSourceOffset, shelfColumns } = input;
  const columnsMemo = new Map<string, number>();
  /**
   * How far right a subtree reaches once it is placed: its own column, plus the
   * widest thing hanging off it.
   *
   * This has to mirror `place` rather than count the longest chain. A subtree
   * one row tall is not necessarily a chain — a screen that opens a handful of
   * leaves packs them side by side on that same row — and a caller that reads
   * this as a chain length reserves too few columns and lays the next side path
   * on top of it.
   */
  const subtreeColumns = (id: string): number => {
    const cached = columnsMemo.get(id);
    if (cached !== undefined) return cached;
    const ownCount = blockById.get(id)?.screenIds.length ?? 1;
    const childrenBySource = layoutChildrenBySource(id, ownCount, children, edgeSourceOffset);
    let reach = 0;
    for (const childIds of childrenBySource) {
      for (const group of groupsFor(childIds)) {
        reach = Math.max(reach, groupColumns(group, subtreeColumns, shelfWidth));
      }
    }
    const columns = 1 + reach;
    columnsMemo.set(id, columns);
    return columns;
  };
  const shelfWidth: ShelfWidth = (id) => {
    if (subtreeRows(id) !== 1) return undefined;
    const columns = subtreeColumns(id);
    return columns <= shelfColumns ? columns : undefined;
  };
  const groupsFor = (childIds: readonly string[]): SiblingGroup[] =>
    siblingLayoutGroups(childIds, shelfWidth, shelfColumns);
  const rowsMemo = new Map<string, number>();
  const subtreeRows = (id: string): number => {
    const cached = rowsMemo.get(id);
    if (cached !== undefined) return cached;
    const ownCount = blockById.get(id)?.screenIds.length ?? 1;
    const childrenBySource = layoutChildrenBySource(id, ownCount, children, edgeSourceOffset);
    let rows = 0;
    for (let sourceIndex = 0; sourceIndex < ownCount; sourceIndex += 1) {
      const groups = groupsFor(childrenBySource[sourceIndex] ?? []);
      const branchRows = groups.reduce((sum, group) => sum + groupRows(group, subtreeRows), 0);
      const siblingGaps = Math.max(0, groups.length - 1) * SIBLING_BRANCH_GAP_ROWS;
      rows += Math.max(1, branchRows + siblingGaps);
      if (sourceIndex < ownCount - 1) rows += VIEWPORT_CHAIN_GAP_ROWS;
    }
    rowsMemo.set(id, rows);
    return rows;
  };

  const positions: Record<string, CanvasPoint> = {};
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
        x: depth * CARD_PITCH_X,
        y: sectionTop * CARD_PITCH_Y,
      };
      let childTop = sectionTop;
      const groups = groupsFor(childrenBySource[sourceIndex] ?? []);
      groups.forEach((group, groupIndex) => {
        if (group.kind === "branch") place(group.id, depth + 1, childTop);
        else {
          group.rows.forEach((rowIds, rowIndex) => {
            let column = 0;
            for (const itemId of rowIds) {
              place(itemId, depth + 1 + column, childTop + rowIndex * (1 + SHELF_ROW_GAP_ROWS));
              column += shelfWidth(itemId) ?? 1;
            }
          });
        }
        childTop += groupRows(group, subtreeRows);
        if (groupIndex < groups.length - 1) childTop += SIBLING_BRANCH_GAP_ROWS;
      });
      sectionTop = Math.max(sectionTop + 1, childTop);
      if (sourceIndex < block.screenIds.length - 1) sectionTop += VIEWPORT_CHAIN_GAP_ROWS;
    });
  };
  // A crawl accepts every state it saw, including the ones it never found a way
  // out of: a settings map is a path plus a drift of Back and Screen frames
  // with no edge at all. Giving each of those its own row turned a readable tree
  // into a mostly empty ribbon several screens tall, so they wrap into a band
  // under the journeys instead of extending the spine.
  const journeys = roots.filter((id) => !isLooseCapture(id, blockById, input.linked));
  const loose = roots.filter((id) => isLooseCapture(id, blockById, input.linked));
  let rootTop = 0;
  for (const [index, band] of rootBands(journeys, input.entries, {
    subtreeRows,
    subtreeColumns,
  }).entries()) {
    if (index) rootTop += ROOT_BAND_GAP_ROWS;
    let column = 0;
    for (const root of band.rootIds) {
      place(root, column, rootTop);
      column += subtreeColumns(root) + SIDE_PATH_GUTTER_COLUMNS;
    }
    rootTop += band.rows;
  }
  if (!loose.length) return positions;
  const columns = Math.max(MIN_LOOSE_BAND_COLUMNS, occupiedColumns(positions));
  const bandTop = journeys.length ? rootTop + LOOSE_BAND_GAP_ROWS : 0;
  loose.forEach((id, index) => {
    positions[blockById.get(id)!.screenIds[0]!] = {
      x: (index % columns) * CARD_PITCH_X,
      y: (bandTop + Math.floor(index / columns)) * CARD_PITCH_Y,
    };
  });
  return positions;
}

/** One horizontal band of the forest: the roots laid out on it, and the height
 * they reserve together. */
type RootBand = { rootIds: readonly string[]; rows: number };

/**
 * Which roots share a band.
 *
 * Roots are siblings of nothing: no screen opens them, so unlike the children
 * of a fan they carry no recorded order between them, only the order they were
 * observed in. Giving each one a band of its own is what is left of the ribbon
 * once a fan is packed — a crawl of one settings app reaches the same Settings
 * state twice and leaves the second one holding two screens, and that pair then
 * spends the full width of the map on two cards.
 *
 * So short roots are packed side by side under the taller ones, in observed
 * order, the way a fan of terminal screens is packed into a shelf. Two rules
 * keep it honest. Packing may never make the map wider than its widest path
 * already is, so a narrow map of short paths still reads as one column per path
 * and nothing is pushed off-canvas. And a band leaves an empty column between
 * two roots, because the graph joins nothing across that gap — the arrangement
 * is filing, not a claim that the second path continues the first.
 */
function rootBands(
  roots: readonly string[],
  entries: readonly string[],
  measure: { subtreeRows: (id: string) => number; subtreeColumns: (id: string) => number },
): RootBand[] {
  const bandFor = (id: string): RootBand => ({ rootIds: [id], rows: measure.subtreeRows(id) });
  const isSidePath = (id: string) =>
    !entries.includes(id) && measure.subtreeRows(id) <= MAX_SIDE_PATH_ROWS;
  const budget = Math.max(0, ...roots.map(measure.subtreeColumns));
  const bands: RootBand[] = [];
  let packed: string[] = [];
  let width = 0;
  const flushPacked = () => {
    if (packed.length) {
      bands.push({ rootIds: packed, rows: Math.max(...packed.map(measure.subtreeRows)) });
    }
    packed = [];
    width = 0;
  };
  for (const id of roots.filter(isSidePath)) {
    const columns = measure.subtreeColumns(id);
    if (packed.length && width + SIDE_PATH_GUTTER_COLUMNS + columns > budget) flushPacked();
    width += (packed.length ? SIDE_PATH_GUTTER_COLUMNS : 0) + columns;
    packed.push(id);
  }
  flushPacked();
  // Nothing shared a band, so nothing was gained: leave every root exactly where
  // the observed order put it rather than reordering a map for no reason.
  if (!bands.some((band) => band.rootIds.length > 1)) return roots.map(bandFor);
  return [...roots.filter((id) => !isSidePath(id)).map(bandFor), ...bands];
}

/** A single screen the graph never joins to anything, in either direction. A
 * multi-screen viewport chain is a path even with no edges around it, so it
 * keeps its own column. */
function isLooseCapture(
  id: string,
  blockById: ReadonlyMap<string, LayoutBlock>,
  linked: ReadonlySet<string>,
): boolean {
  return !linked.has(id) && (blockById.get(id)?.screenIds.length ?? 1) === 1;
}

/** What an arrangement costs a reader: how large it has to be drawn to fit a
 * pane of the proportion it is read in, and the rows and columns it spends
 * getting there. */
type ReadingShape = { size: number; width: number; height: number };

function readingShape(positions: Readonly<Record<string, CanvasPoint>>): ReadingShape {
  const xs = Object.values(positions).map((point) => point.x);
  const ys = Object.values(positions).map((point) => point.y);
  if (!xs.length) return { size: 0, width: 0, height: 0 };
  const width = Math.max(...xs) - Math.min(...xs) + SCREEN_CARD_WIDTH;
  const height = Math.max(...ys) - Math.min(...ys) + SCREEN_CARD_HEIGHT;
  return { size: Math.max(width / READING_PANE_ASPECT, height), width, height };
}

/** Size first, because it is the zoom the map arrives at. Then height, because
 * once the fit is settled a shelf that wraps taller is spending rows the pane
 * was giving away for free. Width last: of two arrangements that read the same,
 * the narrower one is the tidier map. */
function compareReadingShape(left: ReadingShape, right: ReadingShape): number {
  return left.size - right.size || left.height - right.height || left.width - right.width;
}

function occupiedColumns(positions: Readonly<Record<string, CanvasPoint>>): number {
  const xs = Object.values(positions).map((point) => point.x);
  return xs.length ? Math.round(Math.max(...xs) / CARD_PITCH_X) + 1 : 0;
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

function isViewportTransition(label: string | undefined): boolean {
  return /\b(?:scroll|swipe)\b/i.test(label ?? "");
}
