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

  // Preserve deliberate map order inside a layer. This is stable and avoids
  // the unpredictable reshuffling that makes auto-arrange feel destructive.
  for (const layer of layers) {
    layer.sort((left, right) => (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0));
  }
  return layers.filter((layer) => layer.length > 0);
}
