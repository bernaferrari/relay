import type { CanvasNote } from "@relay/protocol";
import type { MapTreeNode } from "./app-map-tree";
import type { CanvasBounds, CanvasPoint, CanvasViewport } from "./app-map-canvas-layout";

/** Shared geometry for the App Map canvas and collaboration presence. */
// Positions reserve one stable slot so mixed phone and tablet maps remain easy
// to arrange. The visible frame follows the captured viewport inside that
// stable slot, so phones remain phones and tablets remain tablets.
export const SCREEN_CARD_WIDTH = 240;
export const SCREEN_CARD_HEIGHT = 230;
export const SCREEN_FRAME_TOP = 30;
export const SCREEN_FRAME_HEIGHT = 200;
/** Keep very narrow phone previews legible without changing their media ratio. */
export const SCREEN_FRAME_MIN_WIDTH = 112;
export const MIN_CANVAS_SCALE = 0.3;
export const MAX_CANVAS_SCALE = 2;
const MIN_FIT_CANVAS_SCALE = 0.06;
const BRANCH_COLUMN_GAP = 136;
const BRANCH_ROW_GAP = 48;
export type ScreenCardGeometry = {
  width: number;
  height: number;
  frameLeft: number;
  frameTop: number;
  frameWidth: number;
  frameHeight: number;
  mediaWidth: number;
  mediaHeight: number;
};

/** The screenshot/device rectangle rendered inside a screen's canvas slot.
 * Titles and other metadata deliberately do not participate in this geometry. */
export type CanvasFrameGeometry = Pick<
  ScreenCardGeometry,
  "frameLeft" | "frameTop" | "frameWidth" | "frameHeight"
>;

export type CanvasFrameBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

export function screenFrameBounds(
  position: CanvasPoint,
  geometry: CanvasFrameGeometry,
): CanvasFrameBounds {
  const left = position.x + geometry.frameLeft;
  const top = position.y + geometry.frameTop;
  const right = left + geometry.frameWidth;
  const bottom = top + geometry.frameHeight;
  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

/** The actual screenshot rectangle inside a screen frame. Interaction anchors
 * use this media box so a highlighted action and its connector always align
 * with the recorded pixels. */
export function screenMediaBounds(
  position: CanvasPoint,
  geometry: Pick<
    ScreenCardGeometry,
    "frameLeft" | "frameTop" | "frameWidth" | "frameHeight" | "mediaWidth" | "mediaHeight"
  >,
): CanvasFrameBounds {
  const left = position.x + geometry.frameLeft + (geometry.frameWidth - geometry.mediaWidth) / 2;
  const top = position.y + geometry.frameTop + (geometry.frameHeight - geometry.mediaHeight) / 2;
  const right = left + geometry.mediaWidth;
  const bottom = top + geometry.mediaHeight;
  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

/** Preserve the target's real silhouette without allowing an extreme viewport
 * to destabilize the graph. Unknown screens keep the neutral preview used by
 * uncaptured states; known phones and tablets fit inside the same layout slot.
 *
 * The frame intentionally follows the media width exactly. A previous minimum
 * frame width added black side gutters around narrow phone screenshots; on a
 * dark capture those gutters visually merged with the bitmap and made the
 * device look wider than the captured screen. */
export function screenCardGeometry(evidence?: {
  logicalViewport?: { width: number; height: number };
}): ScreenCardGeometry {
  const viewport = evidence?.logicalViewport;
  if (!viewport?.width || !viewport.height) {
    return {
      width: SCREEN_CARD_WIDTH,
      height: 204,
      frameLeft: 0,
      frameTop: SCREEN_FRAME_TOP,
      frameWidth: SCREEN_CARD_WIDTH,
      frameHeight: 174,
      mediaWidth: SCREEN_CARD_WIDTH,
      mediaHeight: 174,
    };
  }
  const ratio = viewport.width / viewport.height;
  const boundedRatio = Math.min(2, Math.max(0.46, ratio));
  const mediaWidth =
    boundedRatio >= SCREEN_CARD_WIDTH / SCREEN_FRAME_HEIGHT
      ? SCREEN_CARD_WIDTH
      : SCREEN_FRAME_HEIGHT * boundedRatio;
  const mediaHeight =
    boundedRatio >= SCREEN_CARD_WIDTH / SCREEN_FRAME_HEIGHT
      ? SCREEN_CARD_WIDTH / boundedRatio
      : SCREEN_FRAME_HEIGHT;
  const frameWidth = mediaWidth;
  return {
    width: SCREEN_CARD_WIDTH,
    height: SCREEN_FRAME_TOP + mediaHeight,
    frameLeft: (SCREEN_CARD_WIDTH - frameWidth) / 2,
    frameTop: SCREEN_FRAME_TOP,
    frameWidth,
    frameHeight: mediaHeight,
    mediaWidth,
    mediaHeight,
  };
}

function overlapsScreen(left: CanvasPoint, right: CanvasPoint): boolean {
  return !(
    left.x + SCREEN_CARD_WIDTH + BRANCH_COLUMN_GAP <= right.x ||
    right.x + SCREEN_CARD_WIDTH + BRANCH_COLUMN_GAP <= left.x ||
    left.y + SCREEN_CARD_HEIGHT + BRANCH_ROW_GAP <= right.y ||
    right.y + SCREEN_CARD_HEIGHT + BRANCH_ROW_GAP <= left.y
  );
}

/**
 * Finds the nearest clean slot in the next column for a keyboard-created
 * branch. Alternating below and above keeps siblings near their source while
 * guaranteeing that a second destination never lands directly on the first.
 */
export function nextBranchPosition(
  source: CanvasPoint,
  occupied: readonly CanvasPoint[],
): CanvasPoint {
  const x = source.x + SCREEN_CARD_WIDTH + BRANCH_COLUMN_GAP;
  const row = SCREEN_CARD_HEIGHT + BRANCH_ROW_GAP;
  for (let index = 0; index < 1_000; index += 1) {
    const direction = index === 0 ? 0 : index % 2 === 1 ? 1 : -1;
    const distance = index === 0 ? 0 : Math.ceil(index / 2);
    const candidate = { x, y: source.y + direction * distance * row };
    if (!occupied.some((position) => overlapsScreen(candidate, position))) return candidate;
  }
  return { x, y: source.y + occupied.length * row };
}

export function clampCanvasScale(value: number): number {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value));
}

export function canvasBounds(
  nodes: MapTreeNode[],
  notes: CanvasNote[],
  positionFor: (node: MapTreeNode) => CanvasPoint,
  extras: Array<{ x: number; y: number; width: number; height: number }> = [],
): CanvasBounds {
  if (!nodes.length && !notes.length && !extras.length) {
    return { left: 0, top: 0, right: 760, bottom: 560, width: 760, height: 560 };
  }
  const left = Math.min(
    0,
    ...nodes.map((node) => positionFor(node).x),
    ...notes.map((note) => note.x),
    ...extras.map((item) => item.x),
  );
  const top = Math.min(
    0,
    ...nodes.map((node) => positionFor(node).y),
    ...notes.map((note) => note.y),
    ...extras.map((item) => item.y),
  );
  const right = Math.max(
    ...nodes.map((node) => positionFor(node).x + SCREEN_CARD_WIDTH),
    ...notes.map((note) => note.x + 220),
    ...extras.map((item) => item.x + item.width),
    648,
  );
  const bottom = Math.max(
    ...nodes.map((node) => positionFor(node).y + SCREEN_CARD_HEIGHT),
    ...notes.map((note) => note.y + 132),
    ...extras.map((item) => item.y + item.height),
    448,
  );
  const width = Math.max(760, right - left + 112);
  const height = Math.max(560, bottom - top + 112);
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function fitCanvasViewport(
  client: { width: number; height: number },
  content: { width: number; height: number; left?: number; top?: number },
): CanvasViewport {
  const padding = 56;
  const scale = Math.max(
    MIN_FIT_CANVAS_SCALE,
    Math.min(
      1,
      (client.width - padding * 2) / content.width,
      (client.height - padding * 2) / content.height,
    ),
  );
  return {
    scale,
    x: Math.max(padding, (client.width - content.width * scale) / 2) - (content.left ?? 0) * scale,
    y: Math.max(padding, (client.height - content.height * scale) / 2) - (content.top ?? 0) * scale,
  };
}

/** Initial map framing favors legibility over showing every distant branch.
 * The minimap communicates off-screen content; explicit Fit still shows the
 * whole graph when that overview is what the person wants. */
export function openCanvasViewport(
  client: { width: number; height: number },
  content: { width: number; height: number; left?: number; top?: number },
  minimumReadableScale = 0.55,
): CanvasViewport {
  const fitted = fitCanvasViewport(client, content);
  const scale = clampCanvasScale(Math.max(fitted.scale, minimumReadableScale));
  if (scale === fitted.scale) return fitted;
  return {
    scale,
    x: client.width / 2 - ((content.left ?? 0) + content.width / 2) * scale,
    y: client.height / 2 - ((content.top ?? 0) + content.height / 2) * scale,
  };
}
