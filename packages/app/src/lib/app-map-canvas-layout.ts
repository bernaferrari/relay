import type {
  CanvasInteractionAnchor as ProtocolCanvasInteractionAnchor,
  CanvasNote,
  ConnectionPort,
  ConnectionPresentation,
} from "@relay/protocol";
import type { MapTreeNode } from "./app-map-tree";

export type CanvasPoint = { x: number; y: number };
export type CanvasViewport = CanvasPoint & { scale: number };

export function canvasPointFromClientRect(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  viewport: CanvasViewport,
): CanvasPoint {
  return {
    x: (clientX - rect.left - viewport.x) / viewport.scale,
    y: (clientY - rect.top - viewport.y) / viewport.scale,
  };
}
/**
 * A recorded interaction projected into the visible screen preview.
 * Coordinates are normalized so the map remains correct across screenshot
 * sizes and device targets. This is derived presentation data, never canvas
 * layout state.
 */
export type CanvasInteractionAnchor = ProtocolCanvasInteractionAnchor;
export type CanvasScreenRotation = "none" | "left" | "right";
export type CanvasBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type CanvasEdgeGeometry = {
  path: string;
  labelPoint: CanvasPoint;
  startPoint: CanvasPoint;
  endPoint: CanvasPoint;
  /** A light-weight polyline approximation used for marquee hit-testing. */
  hitPoints: CanvasPoint[];
};

/**
 * Draw the terminal as ordinary path geometry instead of an SVG marker.
 *
 * Markers have their own coordinate system and paint context, which makes
 * their apparent size and color drift away from the connector at different
 * zoom levels. Keeping the arrowhead in the scene means it inherits the same
 * stroke, opacity, line cap, and selection state as the route itself.
 */
export function canvasEdgeArrowPath(
  geometry: Pick<CanvasEdgeGeometry, "endPoint" | "hitPoints">,
  strokeWidth = 2,
): string {
  const end = geometry.endPoint;
  let tangentPoint: CanvasPoint | undefined;

  for (let index = geometry.hitPoints.length - 2; index >= 0; index -= 1) {
    const candidate = geometry.hitPoints[index]!;
    if (Math.hypot(end.x - candidate.x, end.y - candidate.y) > 0.01) {
      tangentPoint = candidate;
      break;
    }
  }
  if (!tangentPoint) return "";

  const deltaX = end.x - tangentPoint.x;
  const deltaY = end.y - tangentPoint.y;
  const distance = Math.hypot(deltaX, deltaY);
  const tangentX = deltaX / distance;
  const tangentY = deltaY / distance;
  const normalX = -tangentY;
  const normalY = tangentX;
  const extraWeight = Math.max(0, strokeWidth - 1);
  const length = 8.5 + extraWeight * 0.75;
  const halfWidth = 4.25 + extraWeight * 0.4;
  const baseX = end.x - tangentX * length;
  const baseY = end.y - tangentY * length;
  const first = {
    x: baseX + normalX * halfWidth,
    y: baseY + normalY * halfWidth,
  };
  const second = {
    x: baseX - normalX * halfWidth,
    y: baseY - normalY * halfWidth,
  };

  return `M ${first.x} ${first.y} L ${end.x} ${end.y} L ${second.x} ${second.y}`;
}

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

export function canvasEdgeGeometry(
  edge: {
    from: string;
    to: string;
    kind: "forward" | "return";
    sourceAnchor?: CanvasInteractionAnchor;
    sourceRotation?: CanvasScreenRotation;
    presentation?: ConnectionPresentation;
  },
  nodes: MapTreeNode[],
  positionFor: (node: MapTreeNode) => CanvasPoint,
  nodeIndex?: ReadonlyMap<string, MapTreeNode>,
  geometryFor?: (node: MapTreeNode) => ScreenCardGeometry,
): CanvasEdgeGeometry {
  const byId = nodeIndex ?? new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  if (!from || !to) {
    return {
      path: "",
      labelPoint: { x: 0, y: 0 },
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
      hitPoints: [],
    };
  }
  const fromPosition = positionFor(from);
  const toPosition = positionFor(to);
  const fromGeometry = geometryFor?.(from) ?? screenCardGeometry();
  const toGeometry = geometryFor?.(to) ?? screenCardGeometry();
  const sourceAnchor = edge.sourceAnchor;
  const sourcePoint = sourceAnchor
    ? pointInDisplayedFrame(sourceAnchor.point, edge.sourceRotation ?? "none")
    : undefined;
  const fromFrame = screenFrameBounds(fromPosition, fromGeometry);
  const toFrame = screenFrameBounds(toPosition, toGeometry);
  const automaticDirection = relativePortDirection(fromFrame, toFrame);
  const direction = explicitPort(edge.presentation?.sourcePort) ?? automaticDirection;
  const targetDirection =
    explicitPort(edge.presentation?.targetPort) ?? oppositePortDirection(automaticDirection);
  const defaultStart = portPoint(fromFrame, direction, edge.presentation?.sourceOffset);
  const start =
    sourcePoint && !explicitPort(edge.presentation?.sourcePort)
      ? {
          x: fromFrame.left + Math.max(0, Math.min(1, sourcePoint.x)) * fromGeometry.frameWidth,
          y: fromFrame.top + Math.max(0, Math.min(1, sourcePoint.y)) * fromGeometry.frameHeight,
        }
      : defaultStart;
  const end = portPoint(toFrame, targetDirection, edge.presentation?.targetOffset);
  const route = edge.presentation?.route ?? "curve";
  if (route === "straight") return straightEdge(start, end);
  if (route === "elbow") return elbowEdge(start, end, direction, targetDirection);
  // Every ordinary connection uses the same curve model. Older routing
  // switched between orthogonal detours and cubics when a card crossed an
  // eight-pixel corridor; a one-pixel drag could therefore redraw the whole
  // wire. Stable topology is more important than speculative obstacle
  // avoidance—the layout and manual snapping keep cards out of the curve.
  if (edge.kind === "return" && !framesAreSeparated(fromFrame, toFrame)) {
    const railY = Math.min(start.y, end.y) - 34;
    return cubicEdge(start, end, { x: start.x, y: railY }, { x: end.x, y: railY });
  }

  const vertical = direction === "top" || direction === "bottom";
  const distance = vertical ? Math.abs(end.y - start.y) : Math.abs(end.x - start.x);
  const pull = Math.max(36, distance * 0.42);
  const sign = direction === "right" || direction === "bottom" ? 1 : -1;
  const control1 = vertical
    ? { x: start.x, y: start.y + sign * pull }
    : { x: start.x + sign * pull, y: start.y };
  const control2 = vertical
    ? { x: end.x, y: end.y - sign * pull }
    : { x: end.x - sign * pull, y: end.y };
  const offset = edge.presentation?.controlOffset;
  if (!offset) return cubicEdge(start, end, control1, control2);
  // Moving both controls by 4/3 of the requested offset moves the cubic's
  // midpoint by exactly that offset, so the drag handle stays under the
  // pointer instead of lagging behind it.
  const adjustment = { x: (offset.x * 4) / 3, y: (offset.y * 4) / 3 };
  return cubicEdge(
    start,
    end,
    { x: control1.x + adjustment.x, y: control1.y + adjustment.y },
    { x: control2.x + adjustment.x, y: control2.y + adjustment.y },
  );
}

type EdgePortDirection = "left" | "right" | "top" | "bottom";

function explicitPort(port: ConnectionPort | undefined): EdgePortDirection | undefined {
  return port && port !== "auto" ? port : undefined;
}

function relativePortDirection(from: CanvasFrameBounds, to: CanvasFrameBounds): EdgePortDirection {
  if (to.left >= from.right) return "right";
  if (to.right <= from.left) return "left";
  if (to.top >= from.bottom) return "bottom";
  if (to.bottom <= from.top) return "top";

  const dx = to.centerX - from.centerX;
  const dy = to.centerY - from.centerY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function oppositePortDirection(direction: EdgePortDirection): EdgePortDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

function portPoint(
  frame: CanvasFrameBounds,
  direction: EdgePortDirection,
  requestedOffset = 0.5,
): CanvasPoint {
  const offset = Math.max(0, Math.min(1, requestedOffset));
  if (direction === "left") {
    return { x: frame.left, y: frame.top + (frame.bottom - frame.top) * offset };
  }
  if (direction === "right") {
    return { x: frame.right, y: frame.top + (frame.bottom - frame.top) * offset };
  }
  if (direction === "top") {
    return { x: frame.left + (frame.right - frame.left) * offset, y: frame.top };
  }
  return { x: frame.left + (frame.right - frame.left) * offset, y: frame.bottom };
}

function straightEdge(start: CanvasPoint, end: CanvasPoint): CanvasEdgeGeometry {
  return {
    path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    labelPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    startPoint: start,
    endPoint: end,
    hitPoints: [start, end],
  };
}

function elbowEdge(
  start: CanvasPoint,
  end: CanvasPoint,
  sourceDirection: EdgePortDirection,
  targetDirection: EdgePortDirection,
): CanvasEdgeGeometry {
  const horizontalSource = sourceDirection === "left" || sourceDirection === "right";
  const horizontalTarget = targetDirection === "left" || targetDirection === "right";
  const bend =
    horizontalSource && horizontalTarget
      ? { x: (start.x + end.x) / 2, y: start.y, x2: (start.x + end.x) / 2, y2: end.y }
      : !horizontalSource && !horizontalTarget
        ? { x: start.x, y: (start.y + end.y) / 2, x2: end.x, y2: (start.y + end.y) / 2 }
        : horizontalSource
          ? { x: end.x, y: start.y, x2: end.x, y2: end.y }
          : { x: start.x, y: end.y, x2: end.x, y2: end.y };
  const points = [start, { x: bend.x, y: bend.y }, { x: bend.x2, y: bend.y2 }, end].filter(
    (point, index, all) =>
      index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y,
  );
  const path = roundedOrthogonalPath(points, 14);
  const middle = points[Math.floor((points.length - 1) / 2)] ?? start;
  return { path, labelPoint: middle, startPoint: start, endPoint: end, hitPoints: points };
}

function roundedOrthogonalPath(points: readonly CanvasPoint[], radius: number): string {
  if (points.length < 2) return "";
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const beforeLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const afterLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cornerRadius = Math.min(radius, beforeLength / 2, afterLength / 2);
    if (cornerRadius <= 0) continue;
    const enter = {
      x: corner.x + ((previous.x - corner.x) / beforeLength) * cornerRadius,
      y: corner.y + ((previous.y - corner.y) / beforeLength) * cornerRadius,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / afterLength) * cornerRadius,
      y: corner.y + ((next.y - corner.y) / afterLength) * cornerRadius,
    };
    path += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  const end = points.at(-1)!;
  return `${path} L ${end.x} ${end.y}`;
}

function framesAreSeparated(from: CanvasFrameBounds, to: CanvasFrameBounds): boolean {
  return (
    from.right <= to.left || to.right <= from.left || from.bottom <= to.top || to.bottom <= from.top
  );
}

function cubicEdge(
  start: CanvasPoint,
  end: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
): CanvasEdgeGeometry {
  return {
    path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`,
    labelPoint: {
      x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8,
      y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8,
    },
    startPoint: start,
    endPoint: end,
    hitPoints: Array.from({ length: 17 }, (_, index) => {
      const t = index / 16;
      const inverse = 1 - t;
      return {
        x:
          inverse ** 3 * start.x +
          3 * inverse ** 2 * t * control1.x +
          3 * inverse * t ** 2 * control2.x +
          t ** 3 * end.x,
        y:
          inverse ** 3 * start.y +
          3 * inverse ** 2 * t * control1.y +
          3 * inverse * t ** 2 * control2.y +
          t ** 3 * end.y,
      };
    }),
  };
}

/** Convert the logical recorded tap into the same displayed frame used by
 * OrientedScreenshot. This keeps an iPad's rotated screenshot, target marker,
 * and connection origin visually consistent. */
export function pointInDisplayedFrame(
  point: CanvasPoint,
  rotation: CanvasScreenRotation,
): CanvasPoint {
  if (rotation === "left") return { x: point.y, y: 1 - point.x };
  if (rotation === "right") return { x: 1 - point.y, y: point.x };
  return point;
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
