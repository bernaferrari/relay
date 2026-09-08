import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
export const MAP_MIN_SCALE = 0.08;
export const MAP_MAX_SCALE = 2.2;
export const MAP_NODE_WIDTH = 208;
export const MAP_NODE_HEIGHT = 388;

export type MapTransform = { x: number; y: number; scale: number };
export type MapPoint = { x: number; y: number };
export type MapBounds = { minX: number; minY: number; maxX: number; maxY: number };

export const INITIAL_TRANSFORM: MapTransform = { x: 48, y: 64, scale: 1 };
const MAP_PADDING = 72;

export function clampMapScale(scale: number): number {
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, scale));
}

export function zoomMapAtPoint(
  transform: MapTransform,
  nextScale: number,
  point: MapPoint,
): MapTransform {
  const scale = clampMapScale(nextScale);
  const ratio = scale / transform.scale;
  return {
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
    scale,
  };
}

export function fitMapToBounds(
  bounds: MapBounds,
  viewport: { width: number; height: number },
): MapTransform {
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampMapScale(
    Math.min(
      1.15,
      Math.max(1, viewport.width - MAP_PADDING * 2) / contentWidth,
      Math.max(1, viewport.height - MAP_PADDING * 2) / contentHeight,
    ),
  );
  return {
    x: (viewport.width - contentWidth * scale) / 2 - bounds.minX * scale,
    y: (viewport.height - contentHeight * scale) / 2 - bounds.minY * scale,
    scale,
  };
}

export function layoutMapScreens(
  screens: readonly ProductMapScreen[],
  paths: readonly ProductMapPath[] = [],
): ReadonlyMap<string, MapPoint> {
  const ids = new Set(screens.map((screen) => screen.id));
  const levels = new Map<string, number>();
  const incoming = new Set(
    paths.filter((path) => path.fromScreenId !== path.toScreenId).map((path) => path.toScreenId),
  );
  const roots = screens.filter((screen) => !incoming.has(screen.id));
  for (const root of [...roots, ...screens]) {
    if (levels.has(root.id)) continue;
    const queue = [{ id: root.id, level: 0 }];
    levels.set(root.id, 0);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]!;
      for (const path of paths) {
        if (
          path.fromScreenId !== current.id ||
          !path.toScreenId ||
          !ids.has(path.toScreenId) ||
          levels.has(path.toScreenId)
        )
          continue;
        levels.set(path.toScreenId, current.level + 1);
        queue.push({ id: path.toScreenId, level: current.level + 1 });
      }
    }
  }
  const columns = new Map<number, ProductMapScreen[]>();
  for (const screen of screens) {
    const level = levels.get(screen.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), screen]);
  }
  const positions = new Map<string, MapPoint>();
  for (const [level, column] of columns)
    column.forEach((screen, index) => {
      positions.set(
        screen.id,
        screen.position ?? { x: level * 340, y: (index - (column.length - 1) / 2) * 468 },
      );
    });
  return positions;
}

export function mapContentBounds(
  screens: readonly ProductMapScreen[],
  positions: ReadonlyMap<string, MapPoint>,
): MapBounds {
  if (!screens.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return screens.reduce<MapBounds>(
    (bounds, screen) => {
      const point = positions.get(screen.id) ?? { x: 0, y: 0 };
      return {
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x + MAP_NODE_WIDTH),
        maxY: Math.max(bounds.maxY, point.y + MAP_NODE_HEIGHT),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}
