import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
export const MAP_MIN_SCALE = 0.08;
export const MAP_MAX_SCALE = 2.2;
export const MAP_NODE_WIDTH = 208;
export const MAP_NODE_HEIGHT = 388;
export const MAP_NODE_TITLE_HEIGHT = 40;
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
): ReadonlyMap<string, MapPoint> {
  const ids = new Set(screens.map((screen) => screen.id));
  const children = new Map<string, string[]>();
  const incoming = new Set<string>();
  // Build a deterministic discovery forest. Return edges never assign a
  // parent or move an already discovered screen into a different branch.
  const visited = new Set<string>();
  const roots: string[] = [];
  const forward = paths.filter(
    (path) =>
      path.toScreenId &&
      path.fromScreenId !== path.toScreenId &&
      ids.has(path.fromScreenId) &&
      ids.has(path.toScreenId) &&
      !/^(back|close|dismiss|return)\b/i.test(path.label),
  );
  for (const path of forward) incoming.add(path.toScreenId!);
  const candidates = [...screens.filter((screen) => !incoming.has(screen.id)), ...screens];
  for (const root of candidates) {
    if (visited.has(root.id)) continue;
    roots.push(root.id);
    visited.add(root.id);
    const queue = [root.id];
    for (let i = 0; i < queue.length; i++) {
      const parent = queue[i]!;
      for (const path of forward.filter((path) => path.fromScreenId === parent)) {
        const child = path.toScreenId!;
        if (visited.has(child)) continue;
        visited.add(child);
        children.set(parent, [...(children.get(parent) ?? []), child]);
        queue.push(child);
      }
    }
  }
  const positions = new Map<string, MapPoint>();
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  let nextRow = 0;
  function place(id: string, depth: number) {
    const row = nextRow;
    positions.set(id, byId.get(id)?.position ?? { x: depth * 420, y: row * 436 });
    const descendants = children.get(id) ?? [];
    if (!descendants.length) nextRow++;
    else for (const child of descendants) place(child, depth + 1);
  }
  for (const root of roots) {
    place(root, 0);
    nextRow++;
  }

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
