import type { MapGroup } from "@relay/protocol";
import {
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasPoint,
} from "./app-map-canvas-layout";

type LayoutGraph = {
  screens: readonly { id: string }[];
  flows: readonly { screenId: string }[];
};

const CARD_GAP_X = 72;
const CARD_GAP_Y = 56;
const SECTION_GAP_X = 128;
const SECTION_GAP_Y = 128;
const SECTION_COLUMNS = 2;

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

  const metrics = sections.map((section) => {
    const columns = sectionColumnCount(section.screenIds.length);
    const rows = Math.ceil(section.screenIds.length / columns);
    return {
      ...section,
      columns,
      width: columns * SCREEN_CARD_WIDTH + Math.max(0, columns - 1) * CARD_GAP_X,
      height: rows * SCREEN_CARD_HEIGHT + Math.max(0, rows - 1) * CARD_GAP_Y,
    };
  });

  const positions: Record<string, CanvasPoint> = {};
  let rowTop = 0;
  for (let rowStart = 0; rowStart < metrics.length; rowStart += SECTION_COLUMNS) {
    const row = metrics.slice(rowStart, rowStart + SECTION_COLUMNS);
    let sectionLeft = 0;
    let rowHeight = 0;
    for (const section of row) {
      section.screenIds.forEach((screenId, index) => {
        positions[screenId] = {
          x: sectionLeft + (index % section.columns) * (SCREEN_CARD_WIDTH + CARD_GAP_X),
          y: rowTop + Math.floor(index / section.columns) * (SCREEN_CARD_HEIGHT + CARD_GAP_Y),
        };
      });
      sectionLeft += section.width + SECTION_GAP_X;
      rowHeight = Math.max(rowHeight, section.height);
    }
    rowTop += rowHeight + SECTION_GAP_Y;
  }

  return positions;
}

function sectionColumnCount(screenCount: number): number {
  if (screenCount <= 2) return screenCount;
  if (screenCount <= 9) return 3;
  return 4;
}
