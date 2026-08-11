import type { MapGroup } from "@relay/protocol";
import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";

export type CrossGroupEdgeBundle = {
  id: string;
  fromGroupId: string;
  toGroupId: string;
  connectionIds: string[];
  path: string;
};

type BundleConnection = {
  id: string;
  fromScreenId: string;
  toScreenId: string;
};

type GroupBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

/**
 * Collapses section-crossing paths into one overview route. Exact screen paths
 * are still available when a screen or section is focused; the bundle only
 * removes wiring noise from the unfocused map.
 */
export function buildCrossGroupEdgeBundles(
  connections: readonly BundleConnection[],
  groups: readonly Pick<MapGroup, "id" | "screenIds">[],
  positions: Readonly<Record<string, CanvasPoint>>,
): CrossGroupEdgeBundle[] {
  const groupForScreen = new Map<string, string>();
  const boundsByGroup = new Map<string, GroupBounds>();

  for (const group of groups) {
    const points = group.screenIds.flatMap((screenId) => {
      groupForScreen.set(screenId, group.id);
      const point = positions[screenId];
      return point ? [point] : [];
    });
    if (!points.length) continue;
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const right = Math.max(...points.map((point) => point.x + SCREEN_CARD_WIDTH));
    const bottom = Math.max(...points.map((point) => point.y + SCREEN_CARD_HEIGHT));
    boundsByGroup.set(group.id, {
      left,
      top,
      right,
      bottom,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    });
  }

  const grouped = new Map<string, { fromGroupId: string; toGroupId: string; ids: string[] }>();
  for (const connection of connections) {
    const fromGroupId = groupForScreen.get(connection.fromScreenId);
    const toGroupId = groupForScreen.get(connection.toScreenId);
    if (!fromGroupId || !toGroupId || fromGroupId === toGroupId) continue;
    const key = `${fromGroupId}\u0000${toGroupId}`;
    const current = grouped.get(key) ?? { fromGroupId, toGroupId, ids: [] };
    current.ids.push(connection.id);
    grouped.set(key, current);
  }

  return [...grouped.values()].flatMap(({ fromGroupId, toGroupId, ids }) => {
    const from = boundsByGroup.get(fromGroupId);
    const to = boundsByGroup.get(toGroupId);
    if (!from || !to) return [];
    return [
      {
        id: `${fromGroupId}->${toGroupId}`,
        fromGroupId,
        toGroupId,
        connectionIds: ids,
        path: bundlePath(from, to),
      },
    ];
  });
}

function bundlePath(from: GroupBounds, to: GroupBounds): string {
  const dx = to.centerX - from.centerX;
  const dy = to.centerY - from.centerY;
  const separatedHorizontally = to.left >= from.right || from.left >= to.right;
  const separatedVertically = to.top >= from.bottom || from.top >= to.bottom;
  if (separatedHorizontally || (!separatedVertically && Math.abs(dx) >= Math.abs(dy))) {
    const forward = dx >= 0;
    const x1 = forward ? from.right : from.left;
    const x2 = forward ? to.left : to.right;
    const pull = Math.max(44, Math.abs(x2 - x1) * 0.42);
    const direction = forward ? 1 : -1;
    return `M ${x1} ${from.centerY} C ${x1 + direction * pull} ${from.centerY}, ${x2 - direction * pull} ${to.centerY}, ${x2} ${to.centerY}`;
  }

  const forward = dy >= 0;
  const y1 = forward ? from.bottom : from.top;
  const y2 = forward ? to.top : to.bottom;
  const pull = Math.max(44, Math.abs(y2 - y1) * 0.42);
  const direction = forward ? 1 : -1;
  return `M ${from.centerX} ${y1} C ${from.centerX} ${y1 + direction * pull}, ${to.centerX} ${y2 - direction * pull}, ${to.centerX} ${y2}`;
}
