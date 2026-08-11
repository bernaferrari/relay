import type { CanvasPoint } from "./app-map-canvas-layout";

const SECTION_GAP_X = 72;
const SECTION_GAP_Y = 72;
const SECTION_COLUMNS = 3;

export type SectionMetric = {
  id: string;
  screenIds: string[];
  width: number;
  height: number;
};

type SectionGraph = {
  transitions: readonly {
    fromScreenId: string;
    destination: { kind: string; screenId?: string };
  }[];
};

type SectionRect = CanvasPoint & SectionMetric;
type SectionEdge = { from: string; to: string };

/** Packs variable-size groups while penalizing overlap, edge crossings, and
 * routes through unrelated groups. Small maps search every deterministic grid
 * arrangement; large maps fall back to dependency layers. */
export function packSectionPositions(
  sections: readonly SectionMetric[],
  graph: SectionGraph,
  startScreenId: string | undefined,
): Record<string, CanvasPoint> {
  const sectionForScreen = new Map<string, string>();
  sections.forEach((section) =>
    section.screenIds.forEach((screenId) => sectionForScreen.set(screenId, section.id)),
  );
  const outgoing = new Map(sections.map((section) => [section.id, new Set<string>()]));
  for (const transition of graph.transitions) {
    const target =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
    const fromSection = sectionForScreen.get(transition.fromScreenId);
    const toSection = target ? sectionForScreen.get(target) : undefined;
    if (!fromSection || !toSection || fromSection === toSection) continue;
    outgoing.get(fromSection)?.add(toSection);
  }
  if (![...outgoing.values()].some((targets) => targets.size)) return gridPositions(sections);

  const preferredStart = startScreenId ? sectionForScreen.get(startScreenId) : undefined;
  return sections.length <= 7
    ? optimizedPositions(sections, outgoing, preferredStart)
    : layeredPositions(sections, outgoing, preferredStart);
}

function optimizedPositions(
  sections: readonly SectionMetric[],
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
  preferredStart: string | undefined,
): Record<string, CanvasPoint> {
  const edges = [...outgoing.entries()].flatMap(([from, targets]) =>
    [...targets].map((to) => ({ from, to })),
  );
  const arrangements = permutations(sections);
  let best: { score: number; positions: Record<string, CanvasPoint> } | undefined;

  for (let columns = 2; columns <= Math.min(4, sections.length); columns += 1) {
    for (const arrangement of arrangements) {
      const candidate = gridArrangement(arrangement, columns);
      const score = arrangementScore(candidate, edges, preferredStart);
      if (!best || score < best.score) best = { score, positions: positionsFromRects(candidate) };
    }
  }
  return best?.positions ?? gridPositions(sections);
}

function layeredPositions(
  sections: readonly SectionMetric[],
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
  preferredStart: string | undefined,
): Record<string, CanvasPoint> {
  const roots = preferredStart
    ? [preferredStart]
    : sections
        .filter((section) => ![...outgoing.values()].some((targets) => targets.has(section.id)))
        .map((section) => section.id);
  const rank = new Map<string, number>();
  const queue = [...new Set(roots.length ? roots : sections.slice(0, 1).map(({ id }) => id))];
  queue.forEach((id) => rank.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index]!;
    const nextRank = (rank.get(from) ?? 0) + 1;
    for (const to of outgoing.get(from) ?? []) {
      if ((rank.get(to) ?? Number.POSITIVE_INFINITY) <= nextRank) continue;
      rank.set(to, nextRank);
      queue.push(to);
    }
  }
  const connectedMax = Math.max(0, ...rank.values());
  for (const section of sections) {
    if (!rank.has(section.id)) rank.set(section.id, connectedMax + 1);
  }

  const layers = new Map<number, SectionMetric[]>();
  for (const section of sections) {
    const layer = rank.get(section.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), section]);
  }
  const layerIndexes = [...layers.keys()].sort((left, right) => left - right);
  const layerHeights = new Map(
    layerIndexes.map((layer) => {
      const items = layers.get(layer) ?? [];
      return [
        layer,
        items.reduce((height, section) => height + section.height, 0) +
          Math.max(0, items.length - 1) * SECTION_GAP_Y,
      ];
    }),
  );
  const layoutHeight = Math.max(...layerHeights.values());
  const positions: Record<string, CanvasPoint> = {};
  let layerLeft = 0;
  for (const layer of layerIndexes) {
    const items = layers.get(layer) ?? [];
    let sectionTop = (layoutHeight - (layerHeights.get(layer) ?? 0)) / 2;
    for (const section of items) {
      positions[section.id] = { x: layerLeft, y: sectionTop };
      sectionTop += section.height + SECTION_GAP_Y;
    }
    layerLeft += Math.max(...items.map((section) => section.width)) + SECTION_GAP_X * 1.5;
  }
  return positions;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => {
    const remaining = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutations(remaining).map((tail) => [item, ...tail]);
  });
}

function gridArrangement(sections: readonly SectionMetric[], columns: number): SectionRect[] {
  const rows = Math.ceil(sections.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  sections.forEach((section, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, section.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, section.height);
  });
  const columnLefts = cumulativeOffsets(columnWidths, SECTION_GAP_X * 1.5);
  const rowTops = cumulativeOffsets(rowHeights, SECTION_GAP_Y * 1.5);
  return sections.map((section, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...section,
      x: (columnLefts[column] ?? 0) + ((columnWidths[column] ?? 0) - section.width) / 2,
      y: (rowTops[row] ?? 0) + ((rowHeights[row] ?? 0) - section.height) / 2,
    };
  });
}

function cumulativeOffsets(sizes: readonly number[], gap: number): number[] {
  const offsets: number[] = [];
  let next = 0;
  for (const size of sizes) {
    offsets.push(next);
    next += size + gap;
  }
  return offsets;
}

function positionsFromRects(rects: readonly SectionRect[]): Record<string, CanvasPoint> {
  return Object.fromEntries(rects.map(({ id, x, y }) => [id, { x, y }]));
}

function arrangementScore(
  rects: readonly SectionRect[],
  edges: readonly SectionEdge[],
  preferredStart: string | undefined,
): number {
  const byId = new Map(rects.map((rect) => [rect.id, rect]));
  const width = Math.max(...rects.map((rect) => rect.x + rect.width));
  const height = Math.max(...rects.map((rect) => rect.y + rect.height));
  let score = Math.abs(Math.log(width / height / 1.7)) * 1_400;
  const segments = edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const start = rectCenter(from);
    const end = rectCenter(to);
    score += Math.hypot(end.x - start.x, end.y - start.y) * 0.18;
    if (end.x + to.width / 2 < start.x - from.width / 2) score += 90;
    for (const obstacle of rects) {
      if (obstacle.id === edge.from || obstacle.id === edge.to) continue;
      if (segmentIntersectsRect(start, end, obstacle)) score += 12_000;
    }
    return [{ ...edge, start, end }];
  });

  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const first = segments[left]!;
      const second = segments[right]!;
      if (
        first.from === second.from ||
        first.from === second.to ||
        first.to === second.from ||
        first.to === second.to
      ) {
        continue;
      }
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) score += 6_000;
    }
  }

  const start = preferredStart ? byId.get(preferredStart) : undefined;
  if (start) {
    const center = rectCenter(start);
    score += Math.hypot(center.x - width / 2, center.y - height / 2) * 0.32;
  }
  return score;
}

function rectCenter(rect: SectionRect): CanvasPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function segmentIntersectsRect(start: CanvasPoint, end: CanvasPoint, rect: SectionRect): boolean {
  const inset = 12;
  const corners = [
    { x: rect.x + inset, y: rect.y + inset },
    { x: rect.x + rect.width - inset, y: rect.y + inset },
    { x: rect.x + rect.width - inset, y: rect.y + rect.height - inset },
    { x: rect.x + inset, y: rect.y + rect.height - inset },
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

function gridPositions(sections: readonly SectionMetric[]): Record<string, CanvasPoint> {
  const positions: Record<string, CanvasPoint> = {};
  let rowTop = 0;
  for (let rowStart = 0; rowStart < sections.length; rowStart += SECTION_COLUMNS) {
    const row = sections.slice(rowStart, rowStart + SECTION_COLUMNS);
    let sectionLeft = 0;
    let rowHeight = 0;
    for (const section of row) {
      positions[section.id] = { x: sectionLeft, y: rowTop };
      sectionLeft += section.width + SECTION_GAP_X;
      rowHeight = Math.max(rowHeight, section.height);
    }
    rowTop += rowHeight + SECTION_GAP_Y;
  }
  return positions;
}
