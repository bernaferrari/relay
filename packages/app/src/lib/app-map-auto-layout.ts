import type { MapGroup } from "@relay/protocol";
import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";
import { packSectionPositions } from "./app-map-section-packing";

type LayoutGraph = {
  screens: readonly { id: string }[];
  flows: readonly { screenId: string }[];
  transitions: readonly {
    fromScreenId: string;
    destination: { kind: string; screenId?: string };
    label?: string;
  }[];
};

const CARD_GAP_X = 40;
const CARD_GAP_Y = 32;
const MAX_LAYER_ROWS = 4;

/**
 * Packs an established map by its visible sections instead of treating every
 * branch as another row in one enormous tree. Group screen order is preserved,
 * so a deliberately curated group also produces a deliberately ordered map.
 */
export function compactGroupedCanvasPositions(
  graph: LayoutGraph,
  groups: readonly Pick<MapGroup, "id" | "screenIds">[],
): Record<string, CanvasPoint> {
  if (!graph.screens.length || !groups.length) return {};

  const screenIds = new Set(graph.screens.map((screen) => screen.id));
  const assigned = new Set<string>();
  const sections = groups
    .map((group) => ({
      id: group.id,
      screenIds: group.screenIds.filter((id) => screenIds.has(id) && !assigned.has(id)),
    }))
    .filter((group) => {
      group.screenIds.forEach((id) => assigned.add(id));
      return group.screenIds.length > 0;
    });
  const ungrouped = graph.screens.map((screen) => screen.id).filter((id) => !assigned.has(id));
  if (ungrouped.length) sections.push({ id: "__ungrouped__", screenIds: ungrouped });

  const startId = graph.flows.find((flow) => screenIds.has(flow.screenId))?.screenId;
  sections.sort((left, right) => {
    const leftStarts = startId ? left.screenIds.includes(startId) : false;
    const rightStarts = startId ? right.screenIds.includes(startId) : false;
    return Number(rightStarts) - Number(leftStarts);
  });

  const metrics = sections.map((section) => ({
    ...section,
    ...layoutSection(section.screenIds, graph.transitions),
  }));
  const sectionOffsets = packSectionPositions(metrics, graph, startId);

  const positions: Record<string, CanvasPoint> = {};
  for (const section of metrics) {
    const offset = sectionOffsets[section.id] ?? { x: 0, y: 0 };
    for (const [screenId, position] of Object.entries(section.positions)) {
      positions[screenId] = { x: offset.x + position.x, y: offset.y + position.y };
    }
  }

  return positions;
}

function layoutSection(
  screenIds: string[],
  transitions: LayoutGraph["transitions"],
): { positions: Record<string, CanvasPoint>; width: number; height: number } {
  const memberIds = new Set(screenIds);
  const scrollNext = new Map<string, string>();
  const scrollTargets = new Set<string>();
  for (const transition of transitions) {
    const target =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
    if (
      !target ||
      !memberIds.has(transition.fromScreenId) ||
      !memberIds.has(target) ||
      !isViewportTransition(transition.label)
    ) {
      continue;
    }
    scrollNext.set(transition.fromScreenId, target);
    scrollTargets.add(target);
  }

  const chains: string[][] = [];
  const chained = new Set<string>();
  for (const screenId of screenIds) {
    if (!scrollNext.has(screenId) || scrollTargets.has(screenId) || chained.has(screenId)) continue;
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = screenId;
    while (current && !seen.has(current) && memberIds.has(current)) {
      chain.push(current);
      chained.add(current);
      seen.add(current);
      current = scrollNext.get(current);
    }
    if (chain.length > 1) chains.push(chain);
  }

  const positions: Record<string, CanvasPoint> = {};
  chains.forEach((chain, column) => {
    chain.forEach((screenId, row) => {
      positions[screenId] = {
        x: column * (SCREEN_CARD_WIDTH + CARD_GAP_X),
        y: row * (SCREEN_CARD_HEIGHT + CARD_GAP_Y),
      };
    });
  });

  const remaining = screenIds.filter((screenId) => !chained.has(screenId));
  const chainWidth = chains.length
    ? chains.length * SCREEN_CARD_WIDTH + Math.max(0, chains.length - 1) * CARD_GAP_X
    : 0;
  const gridLeft = chainWidth ? chainWidth + CARD_GAP_X : 0;
  const layers = topologyLayers(remaining, chained, transitions);
  let layerLeft = gridLeft;
  layers.forEach((layer) => {
    const rowCount = Math.min(MAX_LAYER_ROWS, Math.ceil(Math.sqrt(layer.length)));
    layer.forEach((screenId, index) => {
      positions[screenId] = {
        x: layerLeft + Math.floor(index / rowCount) * (SCREEN_CARD_WIDTH + CARD_GAP_X),
        y: (index % rowCount) * (SCREEN_CARD_HEIGHT + CARD_GAP_Y),
      };
    });
    layerLeft += Math.ceil(layer.length / rowCount) * (SCREEN_CARD_WIDTH + CARD_GAP_X);
  });
  optimizeLayerAssignments(positions, layers, transitions);

  const maxX = Math.max(0, ...Object.values(positions).map(({ x }) => x));
  const maxY = Math.max(0, ...Object.values(positions).map(({ y }) => y));
  return {
    positions,
    width: maxX + SCREEN_CARD_WIDTH,
    height: maxY + SCREEN_CARD_HEIGHT,
  };
}

function isViewportTransition(label: string | undefined): boolean {
  return /\b(?:scroll|swipe)\b/i.test(label ?? "");
}

function topologyLayers(
  screenIds: string[],
  chained: ReadonlySet<string>,
  transitions: LayoutGraph["transitions"],
): string[][] {
  if (!screenIds.length) return [];
  const members = new Set(screenIds);
  const originalIndex = new Map(screenIds.map((id, index) => [id, index]));
  const rank = new Map(screenIds.map((id) => [id, 0]));
  const edges = transitions.flatMap((transition) => {
    const target =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
    if (!target || !members.has(target) || isViewportTransition(transition.label)) return [];
    if (!members.has(transition.fromScreenId) && !chained.has(transition.fromScreenId)) return [];
    return [{ from: transition.fromScreenId, to: target }];
  });

  // Longest-path layering for ordinary DAGs. The iteration cap makes cycles
  // harmless: they stay together instead of pushing the map outward forever.
  for (let pass = 0; pass < screenIds.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = members.has(edge.from) ? (rank.get(edge.from) ?? 0) + 1 : 0;
      if (next <= (rank.get(edge.to) ?? 0) || next >= screenIds.length) continue;
      rank.set(edge.to, next);
      changed = true;
    }
    if (!changed) break;
  }

  const maxRank = Math.max(0, ...rank.values());
  const layers = Array.from({ length: maxRank + 1 }, () => [] as string[]);
  for (const screenId of screenIds) layers[rank.get(screenId) ?? 0]!.push(screenId);

  const populated = layers.filter((layer) => layer.length > 0);
  for (const layer of populated) {
    layer.sort((left, right) => (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0));
  }
  return orderTopologyLayers(populated, edges, originalIndex);
}

/** Repeated forward/backward barycentric sweeps pull connected nodes onto the
 * same visual lanes. A final adjacent-swap pass only accepts improvements, so
 * the result stays deterministic while eliminating avoidable crossings. */
function orderTopologyLayers(
  input: string[][],
  edges: readonly { from: string; to: string }[],
  originalIndex: ReadonlyMap<string, number>,
): string[][] {
  const layers = input.map((layer) => [...layer]);
  const layerById = new Map<string, number>();
  layers.forEach((layer, layerIndex) =>
    layer.forEach((screenId) => layerById.set(screenId, layerIndex)),
  );

  const orderById = () => {
    const order = new Map<string, number>();
    layers.forEach((layer) =>
      layer.forEach((screenId, index) => order.set(screenId, normalizedOrder(index, layer.length))),
    );
    return order;
  };
  const neighborOrder = (
    screenId: string,
    direction: "incoming" | "outgoing",
    order: ReadonlyMap<string, number>,
  ) => {
    const values = edges
      .flatMap((edge) => {
        if (direction === "incoming" && edge.to === screenId) return [order.get(edge.from)];
        if (direction === "outgoing" && edge.from === screenId) return [order.get(edge.to)];
        return [];
      })
      .filter((value): value is number => value !== undefined);
    if (!values.length) return undefined;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const reorder = (layerIndex: number, direction: "incoming" | "outgoing") => {
    const order = orderById();
    layers[layerIndex]!.sort((left, right) => {
      const leftOrder = neighborOrder(left, direction, order);
      const rightOrder = neighborOrder(right, direction, order);
      if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
    });
  };

  for (let pass = 0; pass < 6; pass += 1) {
    for (let layer = 1; layer < layers.length; layer += 1) reorder(layer, "incoming");
    for (let layer = layers.length - 2; layer >= 1; layer -= 1) reorder(layer, "outgoing");
  }

  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
      const layer = layers[layerIndex]!;
      for (let index = 0; index < layer.length - 1; index += 1) {
        const before = topologyOrderPenalty(layers, edges, layerById);
        [layer[index], layer[index + 1]] = [layer[index + 1]!, layer[index]!];
        const after = topologyOrderPenalty(layers, edges, layerById);
        if (after < before) improved = true;
        else [layer[index], layer[index + 1]] = [layer[index + 1]!, layer[index]!];
      }
    }
    if (!improved) break;
  }
  return layers;
}

function topologyOrderPenalty(
  layers: readonly string[][],
  edges: readonly { from: string; to: string }[],
  layerById: ReadonlyMap<string, number>,
): number {
  const order = new Map<string, number>();
  layers.forEach((layer) =>
    layer.forEach((screenId, index) => order.set(screenId, normalizedOrder(index, layer.length))),
  );
  let score = 0;
  for (const edge of edges) {
    const fromOrder = order.get(edge.from);
    const toOrder = order.get(edge.to);
    if (fromOrder === undefined || toOrder === undefined) continue;
    const distance = fromOrder - toOrder;
    score += distance * distance;
  }
  for (let left = 0; left < edges.length; left += 1) {
    const first = edges[left]!;
    for (let right = left + 1; right < edges.length; right += 1) {
      const second = edges[right]!;
      if (
        first.from === second.from ||
        first.to === second.to ||
        layerById.get(first.from) !== layerById.get(second.from) ||
        layerById.get(first.to) !== layerById.get(second.to)
      ) {
        continue;
      }
      const sourceDelta = (order.get(first.from) ?? 0) - (order.get(second.from) ?? 0);
      const targetDelta = (order.get(first.to) ?? 0) - (order.get(second.to) ?? 0);
      if (sourceDelta * targetDelta < 0) score += 12;
    }
  }
  return score;
}

function normalizedOrder(index: number, length: number): number {
  return (index + 0.5) / Math.max(1, length);
}

/** A topology layer can wrap across columns, so its abstract ordering is not
 * necessarily its rendered ordering. Swap cards within each layer using the
 * real geometry to eliminate crossings and routes through unrelated cards. */
function optimizeLayerAssignments(
  positions: Record<string, CanvasPoint>,
  layers: readonly string[][],
  transitions: LayoutGraph["transitions"],
): void {
  const edges = transitions.flatMap((transition) => {
    const target =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
    if (!target || !positions[transition.fromScreenId] || !positions[target]) return [];
    return [{ from: transition.fromScreenId, to: target }];
  });
  const activeLayers = layers.filter((layer) => layer.length > 1);
  const searchSize = activeLayers.reduce(
    (size, layer) => (layer.length > 8 ? Number.POSITIVE_INFINITY : size * factorial(layer.length)),
    1,
  );
  if (searchSize <= 60_000) {
    optimizeLayerAssignmentsExactly(positions, activeLayers, edges);
    return;
  }

  // Small layers are cheap enough to solve exactly. Re-evaluating every layer
  // against the fixed card cells avoids the local-swap traps that can route a
  // connector through a neighboring entry card.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const layer of layers) {
      if (layer.length <= 1) continue;
      const cells = layer.map((screenId) => ({ ...positions[screenId]! }));
      let bestIds = [...layer];
      let bestScore = renderedTopologyPenalty(positions, edges);
      const candidates = layer.length <= 8 ? permutations(layer) : adjacentVariants(layer);
      for (const candidate of candidates) {
        candidate.forEach((screenId, index) => {
          positions[screenId] = cells[index]!;
        });
        const score = renderedTopologyPenalty(positions, edges);
        if (score < bestScore) {
          bestScore = score;
          bestIds = [...candidate];
        }
      }
      bestIds.forEach((screenId, index) => {
        positions[screenId] = cells[index]!;
      });
    }
  }
}

function optimizeLayerAssignmentsExactly(
  positions: Record<string, CanvasPoint>,
  layers: readonly string[][],
  edges: readonly { from: string; to: string }[],
): void {
  const cells = layers.map((layer) => layer.map((screenId) => ({ ...positions[screenId]! })));
  let bestLayers = layers.map((layer) => [...layer]);
  const currentLayers = layers.map((layer) => [...layer]);
  let bestScore = renderedTopologyPenalty(positions, edges);

  const visit = (layerIndex: number) => {
    if (layerIndex >= layers.length) {
      const score = renderedTopologyPenalty(positions, edges);
      if (score < bestScore) {
        bestScore = score;
        bestLayers = currentLayers.map((layer) => [...layer]);
      }
      return;
    }
    const layer = layers[layerIndex]!;
    for (const candidate of permutations(layer)) {
      currentLayers[layerIndex] = [...candidate];
      candidate.forEach((screenId, index) => {
        positions[screenId] = cells[layerIndex]![index]!;
      });
      visit(layerIndex + 1);
    }
  };
  visit(0);
  bestLayers.forEach((layer, layerIndex) =>
    layer.forEach((screenId, index) => {
      positions[screenId] = cells[layerIndex]![index]!;
    }),
  );
}

function factorial(value: number): number {
  let result = 1;
  for (let next = 2; next <= value; next += 1) result *= next;
  return result;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutations(rest).map((tail) => [item, ...tail]);
  });
}

function adjacentVariants<T>(items: readonly T[]): T[][] {
  return items.slice(0, -1).map((_, index) => {
    const variant = items.slice();
    [variant[index], variant[index + 1]] = [variant[index + 1]!, variant[index]!];
    return variant;
  });
}

function renderedTopologyPenalty(
  positions: Readonly<Record<string, CanvasPoint>>,
  edges: readonly { from: string; to: string }[],
): number {
  const center = (screenId: string) => ({
    x: positions[screenId]!.x + SCREEN_CARD_WIDTH / 2,
    y: positions[screenId]!.y + SCREEN_CARD_HEIGHT / 2,
  });
  let score = 0;
  const segments = edges.map((edge) => {
    const start = center(edge.from);
    const end = center(edge.to);
    score += Math.hypot(end.x - start.x, end.y - start.y) * 0.025;
    if (end.x < start.x) score += 900;
    for (const [screenId, position] of Object.entries(positions)) {
      if (screenId === edge.from || screenId === edge.to) continue;
      if (segmentIntersectsCard(start, end, position)) score += 4_000;
    }
    return { ...edge, start, end };
  });

  for (let left = 0; left < segments.length - 1; left += 1) {
    const first = segments[left]!;
    for (let right = left + 1; right < segments.length; right += 1) {
      const second = segments[right]!;
      if (
        first.from === second.from ||
        first.from === second.to ||
        first.to === second.from ||
        first.to === second.to
      ) {
        continue;
      }
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) score += 8_000;
    }
  }
  return score;
}

function segmentIntersectsCard(start: CanvasPoint, end: CanvasPoint, card: CanvasPoint): boolean {
  const inset = 8;
  const corners = [
    { x: card.x + inset, y: card.y + inset },
    { x: card.x + SCREEN_CARD_WIDTH - inset, y: card.y + inset },
    {
      x: card.x + SCREEN_CARD_WIDTH - inset,
      y: card.y + SCREEN_CARD_HEIGHT - inset,
    },
    { x: card.x + inset, y: card.y + SCREEN_CARD_HEIGHT - inset },
  ];
  return corners.some((corner, index) =>
    segmentsIntersect(start, end, corner, corners[(index + 1) % corners.length]!),
  );
}

function segmentsIntersect(
  firstStart: CanvasPoint,
  firstEnd: CanvasPoint,
  secondStart: CanvasPoint,
  secondEnd: CanvasPoint,
): boolean {
  const cross = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const firstA = cross(firstStart, firstEnd, secondStart);
  const firstB = cross(firstStart, firstEnd, secondEnd);
  const secondA = cross(secondStart, secondEnd, firstStart);
  const secondB = cross(secondStart, secondEnd, firstEnd);
  return firstA * firstB < 0 && secondA * secondB < 0;
}
