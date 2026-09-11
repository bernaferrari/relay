import { orderMapBranches } from "./map-branch-order";
import { layoutMapGraph, separateMapScreens, reserveStraightConnections } from "./map-layout";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
export const MAP_MIN_SCALE = 0.08;
export const MAP_MAX_SCALE = 2.2;
export const MAP_NODE_WIDTH = 208;
export const MAP_NODE_HEIGHT = 380;
export const MAP_NODE_TITLE_HEIGHT = 32;
export const MAP_NODE_GAP = 8;
export const MAP_NODE_IMAGE_HEIGHT = 300;

export type MapTransform = { x: number; y: number; scale: number };
export type MapPoint = { x: number; y: number };
export type MapBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type ImageDimensions = { width: number; height: number };

export const INITIAL_TRANSFORM: MapTransform = { x: 48, y: 64, scale: 1 };
const MAP_PADDING = 72;

/** The rendered image area for object-contain, excluding the letterbox. */
export function containedImageRect(
  box: { x: number; y: number; width: number; height: number },
  image: ImageDimensions,
  align: "center" | "top" = "center",
): { x: number; y: number; width: number; height: number } | undefined {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return undefined;
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (align === "top" ? 0 : (box.height - height) / 2),
    width,
    height,
  };
}

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
  mode: "aligned" | "staggered" | "horizontal" = "aligned",
): ReadonlyMap<string, MapPoint> {
  const positions = layoutMapGraph(
    screens.map((screen) => screen.id),
    orderMapBranches(
      paths.filter(
        (path) =>
          path.toScreenId && !/^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label),
      ),
      mode === "horizontal",
    )
      .filter(
        (path) =>
          path.toScreenId && !/^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label),
      )
      .map((path) => ({ from: path.fromScreenId, to: path.toScreenId! })),
    mode === "horizontal" ? 600 : mode === "staggered" ? 560 : MAP_NODE_WIDTH + 160,
    mode === "horizontal" ? MAP_NODE_WIDTH + 112 : MAP_NODE_HEIGHT + 40,
    mode === "staggered",
  );
  if (mode === "horizontal") {
    // Exchange flow and branch axes without rotating the portrait captures.
    for (const [id, point] of positions) positions.set(id, { x: point.y, y: point.x });
    for (const screen of screens) if (screen.position) positions.set(screen.id, screen.position);
    return separateMapScreens(
      positions,
      new Set(screens.filter((s) => s.position).map((s) => s.id)),
      MAP_NODE_WIDTH,
      MAP_NODE_HEIGHT,
    );
  }
  // Dense branches need a wider routing corridor than a simple continuation.
  const columns = [...new Set([...positions.values()].map((point) => point.x))].sort(
    (a, b) => a - b,
  );
  const widths = new Map<number, number>();
  for (const screen of screens) {
    const x = positions.get(screen.id)!.x;
    const count = paths.filter(
      (path) =>
        path.fromScreenId === screen.id &&
        path.toScreenId &&
        !/^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label),
    ).length;
    widths.set(x, Math.max(widths.get(x) ?? 0, MAP_NODE_WIDTH + 160 + Math.max(0, count - 1) * 12));
  }
  const columnPositions = new Map<number, number>();
  let nextX = 0;
  for (const column of columns) {
    columnPositions.set(column, nextX);
    nextX += widths.get(column) ?? MAP_NODE_WIDTH + 160;
  }
  if (mode === "aligned")
    for (const point of positions.values()) point.x = columnPositions.get(point.x)!;
  for (const screen of screens) if (screen.position) positions.set(screen.id, screen.position);

  const separated = separateMapScreens(
    positions,
    new Set(screens.filter((screen) => screen.position).map((screen) => screen.id)),
    MAP_NODE_WIDTH,
    MAP_NODE_HEIGHT,
  );
  return reserveStraightConnections(
    separated,
    paths
      .filter(
        (path) =>
          path.toScreenId && !/^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label),
      )
      .map((path) => ({ from: path.fromScreenId, to: path.toScreenId! })),
    MAP_NODE_WIDTH,
    MAP_NODE_HEIGHT,
  );
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
