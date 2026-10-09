import { mapEntryScreenIds } from "./map-entry-screens";
import { layeredMapLayout } from "./map-layered-layout";
import { separateMapScreens } from "./map-layout";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
export const MAP_MIN_SCALE = 0.08;
export const MAP_MAX_SCALE = 2.2;

/** A screen on the canvas: title, gap, screenshot box, and room for chips below. */
export type MapNodeSize = {
  width: number;
  height: number;
  titleHeight: number;
  gap: number;
  imageHeight: number;
};

/** Phones: tall, narrow screenshots. */
export const PORTRAIT_NODE: MapNodeSize = {
  width: 208,
  height: 368,
  titleHeight: 20,
  gap: 8,
  imageHeight: 300,
};

/** Tablets in landscape and browsers: wide screenshots get a wide box. */
export const LANDSCAPE_NODE: MapNodeSize = {
  width: 360,
  height: 308,
  titleHeight: 20,
  gap: 8,
  imageHeight: 240,
};

export const MAP_NODE_WIDTH = PORTRAIT_NODE.width;
export const MAP_NODE_HEIGHT = PORTRAIT_NODE.height;
export const MAP_NODE_TITLE_HEIGHT = PORTRAIT_NODE.titleHeight;
export const MAP_NODE_GAP = PORTRAIT_NODE.gap;
export const MAP_NODE_IMAGE_HEIGHT = PORTRAIT_NODE.imageHeight;

/** One shape per map, from the screenshots seen so far: most wide → landscape. */
export function mapNodeSizeFor(dimensions: Iterable<ImageDimensions>): MapNodeSize {
  let wide = 0,
    total = 0;
  for (const image of dimensions) {
    total += 1;
    if (image.width > image.height * 1.15) wide += 1;
  }
  return total && wide * 2 > total ? LANDSCAPE_NODE : PORTRAIT_NODE;
}

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

/** Centered fit. `readableScale` keeps a large map legible on open: the view
 * stays centered and the edges may overflow instead of shrinking further. */
export function fitMapToBounds(
  bounds: MapBounds,
  viewport: { width: number; height: number },
  readableScale = MAP_MIN_SCALE,
): MapTransform {
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampMapScale(
    Math.max(
      readableScale,
      Math.min(
        1.15,
        Math.max(1, viewport.width - MAP_PADDING * 2) / contentWidth,
        Math.max(1, viewport.height - MAP_PADDING * 2) / contentHeight,
      ),
    ),
  );
  // Centre what fits. When the readable scale overflows an axis, start where
  // the journey starts (top-left) instead of clipping both of its ends.
  const align = (available: number, size: number, min: number) =>
    size + MAP_PADDING * 2 <= available
      ? (available - size) / 2 - min * scale
      : MAP_PADDING / 2 - min * scale;
  return {
    x: align(viewport.width, contentWidth * scale, bounds.minX),
    y: align(viewport.height, contentHeight * scale, bounds.minY),
    scale,
  };
}

const RETURN_LABEL = /^(back|close|dismiss|return|cancel|disable)\b/i;

/** Columns by distance from the entry screen; see map-layered-layout. */
export function layoutMapScreens(
  screens: readonly ProductMapScreen[],
  paths: readonly ProductMapPath[] = [],
  node: MapNodeSize = PORTRAIT_NODE,
): ReadonlyMap<string, MapPoint> {
  const positions = layeredMapLayout(
    screens.map((screen) => screen.id),
    [...paths]
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((path) => path.toScreenId && !RETURN_LABEL.test(path.label))
      .map((path) => ({ from: path.fromScreenId, to: path.toScreenId! })),
    { width: node.width, height: node.height, roots: mapEntryScreenIds(screens, paths) },
  );
  for (const screen of screens) if (screen.position) positions.set(screen.id, screen.position);
  return separateMapScreens(
    positions,
    new Set(screens.filter((screen) => screen.position).map((screen) => screen.id)),
    node.width,
    node.height,
  );
}

export function mapContentBounds(
  screens: readonly ProductMapScreen[],
  positions: ReadonlyMap<string, MapPoint>,
  node: MapNodeSize = PORTRAIT_NODE,
): MapBounds {
  if (!screens.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return screens.reduce<MapBounds>(
    (bounds, screen) => {
      const point = positions.get(screen.id) ?? { x: 0, y: 0 };
      return {
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x + node.width),
        maxY: Math.max(bounds.maxY, point.y + node.height),
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
