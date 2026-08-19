import type { CanvasPoint, CanvasViewport } from "./app-map-canvas-layout";
import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH } from "./app-map-screen-layout";

export type AppMapMinimapBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Panel width less its inset. The overview draws into exactly this box. */
export const MINIMAP_CONTENT_WIDTH = 176;
const MINIMAP_MIN_HEIGHT = 76;
const MINIMAP_MAX_HEIGHT = 148;

/**
 * Height that lets the overview keep the map's own proportions. A fixed box
 * squeezed a wide 44-screen map into a horizontal band, and every card became a
 * stripe: the barcode. Sizing the box to the content means the marks below can
 * stay square-ish and the shape of the map is readable at a glance.
 */
export function minimapBoxHeight(
  content: { width: number; height: number },
  boxWidth = MINIMAP_CONTENT_WIDTH,
): number {
  const ratio = content.height / Math.max(1, content.width);
  if (!Number.isFinite(ratio) || ratio <= 0) return MINIMAP_MIN_HEIGHT;
  return Math.round(Math.min(MINIMAP_MAX_HEIGHT, Math.max(MINIMAP_MIN_HEIGHT, boxWidth * ratio)));
}

const MARK_MIN_PX = 3;
const MARK_MAX_PX = 11;

/**
 * Mark size in the 0–100 overview space, chosen so the mark is *square in
 * pixels* once the box has stretched that space.
 *
 * This is the barcode. A tall 44-screen map is roughly five times taller than
 * it is wide, but the box it draws into is wider than tall, so the two axes are
 * scaled by wildly different factors. Sizing each axis from the card's own
 * proportions therefore produced a 25×10px bar per screen, and forty of them
 * side by side is a barcode. An overview answers "where am I and how dense is
 * this", not "how tall is a phone", so the mark takes a single size — the
 * smaller of the two projections, which keeps neighbours from merging — and
 * spends it equally on both axes.
 */
export function minimapMarkSize(
  content: { width: number; height: number },
  boxHeight = MINIMAP_MIN_HEIGHT,
  boxWidth = MINIMAP_CONTENT_WIDTH,
): { width: number; height: number } {
  const projected = Math.min(
    (SCREEN_CARD_WIDTH / Math.max(1, content.width)) * boxWidth,
    (SCREEN_CARD_HEIGHT / Math.max(1, content.height)) * boxHeight,
  );
  const size = Math.min(MARK_MAX_PX, Math.max(MARK_MIN_PX, projected));
  return { width: (size / boxWidth) * 100, height: (size / boxHeight) * 100 };
}

export function minimapPoint(
  point: CanvasPoint,
  content: { width: number; height: number; left?: number; top?: number },
): CanvasPoint {
  return {
    x: clampPercent(((point.x - (content.left ?? 0)) / Math.max(1, content.width)) * 100),
    y: clampPercent(((point.y - (content.top ?? 0)) / Math.max(1, content.height)) * 100),
  };
}

export function minimapViewportBounds(
  viewport: CanvasViewport,
  client: { width: number; height: number },
  content: { width: number; height: number; left?: number; top?: number },
): AppMapMinimapBounds {
  const worldLeft = -viewport.x / viewport.scale;
  const worldTop = -viewport.y / viewport.scale;
  const worldRight = worldLeft + client.width / viewport.scale;
  const worldBottom = worldTop + client.height / viewport.scale;
  const contentLeft = content.left ?? 0;
  const contentTop = content.top ?? 0;
  const left = clampPercent(((worldLeft - contentLeft) / Math.max(1, content.width)) * 100);
  const top = clampPercent(((worldTop - contentTop) / Math.max(1, content.height)) * 100);
  const right = clampPercent(((worldRight - contentLeft) / Math.max(1, content.width)) * 100);
  const bottom = clampPercent(((worldBottom - contentTop) / Math.max(1, content.height)) * 100);
  const width = Math.min(100, Math.max(3, right - left));
  const height = Math.min(100, Math.max(3, bottom - top));
  return {
    left: Math.min(left, 100 - width),
    top: Math.min(top, 100 - height),
    width,
    height,
  };
}

export function minimapWorldPoint(
  ratio: CanvasPoint,
  content: { width: number; height: number; left?: number; top?: number },
): CanvasPoint {
  return {
    x: (content.left ?? 0) + clampUnit(ratio.x) * content.width,
    y: (content.top ?? 0) + clampUnit(ratio.y) * content.height,
  };
}

export function centerCanvasViewport(
  viewport: CanvasViewport,
  client: { width: number; height: number },
  point: CanvasPoint,
): CanvasViewport {
  return {
    ...viewport,
    x: client.width / 2 - point.x * viewport.scale,
    y: client.height / 2 - point.y * viewport.scale,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
