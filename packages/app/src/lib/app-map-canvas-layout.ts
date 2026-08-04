import type { CanvasNote } from "@relay/protocol";
import type { MapTreeNode } from "./app-map-tree";

export type CanvasPoint = { x: number; y: number };
export type CanvasViewport = CanvasPoint & { scale: number };
/**
 * A recorded interaction projected into the visible screen preview.
 * Coordinates are normalized so the map remains correct across screenshot
 * sizes and device targets. This is derived presentation data, never canvas
 * layout state.
 */
export type CanvasInteractionAnchor = {
  point: CanvasPoint;
  rect?: { x: number; y: number; width: number; height: number };
};
export type CanvasBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

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
export const MAX_CANVAS_SCALE = 1.25;
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

/** Preserve the target's real silhouette without allowing an extreme viewport
 * to destabilize the graph. Unknown screens keep the neutral preview used by
 * uncaptured states; known phones and tablets fit inside the same layout slot. */
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
  const frameWidth = Math.max(SCREEN_FRAME_MIN_WIDTH, mediaWidth);
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
): CanvasBounds {
  if (!nodes.length && !notes.length) {
    return { left: 0, top: 0, right: 760, bottom: 560, width: 760, height: 560 };
  }
  const left = Math.min(
    0,
    ...nodes.map((node) => positionFor(node).x),
    ...notes.map((note) => note.x),
  );
  const top = Math.min(
    0,
    ...nodes.map((node) => positionFor(node).y),
    ...notes.map((note) => note.y),
  );
  const right = Math.max(
    ...nodes.map((node) => positionFor(node).x + SCREEN_CARD_WIDTH),
    ...notes.map((note) => note.x + 220),
    648,
  );
  const bottom = Math.max(
    ...nodes.map((node) => positionFor(node).y + SCREEN_CARD_HEIGHT),
    ...notes.map((note) => note.y + 132),
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
  const scale = clampCanvasScale(
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

export function canvasEdgeGeometry(
  edge: {
    from: string;
    to: string;
    kind: "forward" | "return";
    sourceAnchor?: CanvasInteractionAnchor;
  },
  nodes: MapTreeNode[],
  positionFor: (node: MapTreeNode) => CanvasPoint,
  nodeIndex?: ReadonlyMap<string, MapTreeNode>,
  geometryFor?: (node: MapTreeNode) => ScreenCardGeometry,
): { path: string; labelPoint: CanvasPoint } {
  const byId = nodeIndex ?? new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  if (!from || !to) return { path: "", labelPoint: { x: 0, y: 0 } };
  const fromPosition = positionFor(from);
  const toPosition = positionFor(to);
  const fromGeometry = geometryFor?.(from) ?? screenCardGeometry();
  const toGeometry = geometryFor?.(to) ?? screenCardGeometry();
  if (edge.kind === "return") {
    const startX = fromPosition.x + fromGeometry.frameLeft + fromGeometry.frameWidth / 2;
    const startY = fromPosition.y + fromGeometry.frameTop;
    const endX = toPosition.x + toGeometry.frameLeft + toGeometry.frameWidth / 2;
    const endY = toPosition.y + toGeometry.frameTop;
    const railY = Math.min(startY, endY) - 34;
    return {
      path: `M ${startX} ${startY} C ${startX} ${railY}, ${endX} ${railY}, ${endX} ${endY}`,
      labelPoint: {
        x: (startX + endX) / 2,
        y: (startY + 6 * railY + endY) / 8,
      },
    };
  }
  const sourceAnchor = edge.sourceAnchor;
  const startX =
    fromPosition.x +
    fromGeometry.frameLeft +
    (sourceAnchor
      ? Math.max(0, Math.min(1, sourceAnchor.point.x)) * fromGeometry.frameWidth
      : fromGeometry.frameWidth);
  const startY =
    fromPosition.y +
    fromGeometry.frameTop +
    (sourceAnchor
      ? Math.max(0, Math.min(1, sourceAnchor.point.y)) * fromGeometry.frameHeight
      : fromGeometry.frameHeight / 2);
  const endX = toPosition.x + toGeometry.frameLeft;
  const endY = toPosition.y + toGeometry.frameTop + toGeometry.frameHeight / 2;
  return {
    path: `M ${startX} ${startY} C ${startX + 48} ${startY}, ${endX - 48} ${endY}, ${endX} ${endY}`,
    labelPoint: {
      x: (startX + 3 * (startX + 48) + 3 * (endX - 48) + endX) / 8,
      y: (startY + endY) / 2,
    },
  };
}

export function draftCanvasConnectionPath(
  fromId: string,
  point: CanvasPoint,
  nodes: MapTreeNode[],
  positionFor: (node: MapTreeNode) => CanvasPoint,
  geometryFor?: (node: MapTreeNode) => ScreenCardGeometry,
): string {
  const from = nodes.find((node) => node.id === fromId);
  if (!from) return "";
  const origin = positionFor(from);
  const geometry = geometryFor?.(from) ?? screenCardGeometry();
  const startX = origin.x + geometry.frameLeft + geometry.frameWidth;
  const startY = origin.y + geometry.frameTop + geometry.frameHeight / 2;
  return `M ${startX} ${startY} C ${startX + 48} ${startY}, ${point.x - 48} ${point.y}, ${point.x} ${point.y}`;
}
