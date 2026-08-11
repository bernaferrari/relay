import type {
  CanvasInteractionAnchor as ProtocolCanvasInteractionAnchor,
  CanvasNote,
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
  },
  nodes: MapTreeNode[],
  positionFor: (node: MapTreeNode) => CanvasPoint,
  nodeIndex?: ReadonlyMap<string, MapTreeNode>,
  geometryFor?: (node: MapTreeNode) => ScreenCardGeometry,
): { path: string; labelPoint: CanvasPoint; startPoint: CanvasPoint; endPoint: CanvasPoint } {
  const byId = nodeIndex ?? new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  if (!from || !to) {
    return {
      path: "",
      labelPoint: { x: 0, y: 0 },
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
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
  const fromFrame = frameBounds(fromPosition, fromGeometry);
  const toFrame = frameBounds(toPosition, toGeometry);
  const direction = relativePortDirection(fromFrame, toFrame);
  const defaultStart = portPoint(fromFrame, direction);
  const start = sourcePoint
    ? {
        x: fromFrame.left + Math.max(0, Math.min(1, sourcePoint.x)) * fromGeometry.frameWidth,
        y: fromFrame.top + Math.max(0, Math.min(1, sourcePoint.y)) * fromGeometry.frameHeight,
      }
    : defaultStart;
  const end = portPoint(toFrame, oppositePortDirection(direction));
  const obstacles = nodes.flatMap((node) => {
    if (node.id === from.id || node.id === to.id) return [];
    return [frameBounds(positionFor(node), geometryFor?.(node) ?? screenCardGeometry())];
  });
  const routed = structuredEdge(
    start,
    Boolean(sourcePoint),
    fromFrame,
    toFrame,
    direction,
    obstacles,
  );
  if (routed) return routed;

  // Return paths without a recorded origin used to share a small top rail.
  // Relative ports are clearer for separated cards, while the rail remains a
  // useful fallback for overlapping/cyclic states.
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
  return cubicEdge(start, end, control1, control2);
}

type EdgePortDirection = "left" | "right" | "top" | "bottom";

type FrameBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

function frameBounds(position: CanvasPoint, geometry: ScreenCardGeometry): FrameBounds {
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

function relativePortDirection(from: FrameBounds, to: FrameBounds): EdgePortDirection {
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

function portPoint(frame: FrameBounds, direction: EdgePortDirection): CanvasPoint {
  if (direction === "left") return { x: frame.left, y: frame.centerY };
  if (direction === "right") return { x: frame.right, y: frame.centerY };
  if (direction === "top") return { x: frame.centerX, y: frame.top };
  return { x: frame.centerX, y: frame.bottom };
}

function framesAreSeparated(from: FrameBounds, to: FrameBounds): boolean {
  return (
    from.right <= to.left || to.right <= from.left || from.bottom <= to.top || to.bottom <= from.top
  );
}

function structuredEdge(
  recordedStart: CanvasPoint,
  hasRecordedStart: boolean,
  from: FrameBounds,
  to: FrameBounds,
  direction: EdgePortDirection,
  obstacles: readonly FrameBounds[],
):
  | { path: string; labelPoint: CanvasPoint; startPoint: CanvasPoint; endPoint: CanvasPoint }
  | undefined {
  // Long connections keep the same reading direction as their endpoints:
  // leave through the natural side, use a row/column gutter, then enter the
  // destination through its natural side. This avoids decorative arcs that
  // visually jump over unrelated screens.
  const margin = 48;
  const stub = 28;
  const horizontal = direction === "left" || direction === "right";
  if (horizontal) {
    const start = hasRecordedStart ? recordedStart : portPoint(from, direction);
    const end = portPoint(to, oppositePortDirection(direction));
    const directionSign = direction === "right" ? 1 : -1;
    const sourceEdge = direction === "right" ? from.right : from.left;
    const targetEdge = direction === "right" ? to.left : to.right;
    const corridorLeft = Math.min(from.right, to.right);
    const corridorRight = Math.max(from.left, to.left);
    const corridorTop = Math.min(from.centerY, to.centerY) - 8;
    const corridorBottom = Math.max(from.centerY, to.centerY) + 8;
    const blockers = obstacles.filter(
      (frame) =>
        frame.right > corridorLeft &&
        frame.left < corridorRight &&
        frame.bottom > corridorTop &&
        frame.top < corridorBottom,
    );
    const crossRow = Math.abs(from.centerY - to.centerY) > (from.bottom - from.top) * 0.75;
    if (crossRow && blockers.length) {
      const channels = [
        (sourceEdge + targetEdge) / 2,
        sourceEdge + directionSign * stub,
        targetEdge - directionSign * stub,
      ];
      for (const channel of channels) {
        const points = compactOrthogonalPoints([
          start,
          { x: sourceEdge, y: start.y },
          { x: channel, y: start.y },
          { x: channel, y: end.y },
          end,
        ]);
        if (routeClearsObstacles(points, obstacles)) {
          return orthogonalEdge(points, {
            x: channel,
            y: (start.y + end.y) / 2,
          });
        }
      }
    }
    if (!blockers.length) return undefined;
    const topRail = Math.min(from.top, to.top, ...blockers.map((frame) => frame.top)) - margin;
    const bottomRail =
      Math.max(from.bottom, to.bottom, ...blockers.map((frame) => frame.bottom)) + margin;
    const routeFor = (rail: number) =>
      compactOrthogonalPoints([
        start,
        { x: sourceEdge, y: start.y },
        { x: sourceEdge + directionSign * stub, y: start.y },
        { x: sourceEdge + directionSign * stub, y: rail },
        { x: targetEdge - directionSign * stub, y: rail },
        { x: targetEdge - directionSign * stub, y: end.y },
        end,
      ]);
    // In a left-to-right map, the gutter below a row preserves the natural
    // scan order and leaves section labels above the cards unobstructed.
    const bottomRoute = routeFor(bottomRail);
    const topRoute = routeFor(topRail);
    const points = routeClearsObstacles(bottomRoute, obstacles)
      ? bottomRoute
      : routeClearsObstacles(topRoute, obstacles)
        ? topRoute
        : bottomRoute;
    return orthogonalEdge(points, {
      x: (sourceEdge + targetEdge) / 2,
      y: points === topRoute ? topRail : bottomRail,
    });
  }

  const start = hasRecordedStart ? recordedStart : portPoint(from, direction);
  const end = portPoint(to, oppositePortDirection(direction));
  const directionSign = direction === "bottom" ? 1 : -1;
  const sourceEdge = direction === "bottom" ? from.bottom : from.top;
  const targetEdge = direction === "bottom" ? to.top : to.bottom;
  const corridorTop = Math.min(from.bottom, to.bottom);
  const corridorBottom = Math.max(from.top, to.top);
  const corridorLeft = Math.min(from.centerX, to.centerX) - 8;
  const corridorRight = Math.max(from.centerX, to.centerX) + 8;
  const blockers = obstacles.filter(
    (frame) =>
      frame.bottom > corridorTop &&
      frame.top < corridorBottom &&
      frame.right > corridorLeft &&
      frame.left < corridorRight,
  );
  const crossColumn = Math.abs(from.centerX - to.centerX) > (from.right - from.left) * 0.75;
  if (crossColumn && blockers.length) {
    const channels = [
      (sourceEdge + targetEdge) / 2,
      sourceEdge + directionSign * stub,
      targetEdge - directionSign * stub,
    ];
    for (const channel of channels) {
      const points = compactOrthogonalPoints([
        start,
        { x: start.x, y: sourceEdge },
        { x: start.x, y: channel },
        { x: end.x, y: channel },
        end,
      ]);
      if (routeClearsObstacles(points, obstacles)) {
        return orthogonalEdge(points, {
          x: (start.x + end.x) / 2,
          y: channel,
        });
      }
    }
  }
  if (!blockers.length) return undefined;
  const leftRail = Math.min(from.left, to.left, ...blockers.map((frame) => frame.left)) - margin;
  const rightRail =
    Math.max(from.right, to.right, ...blockers.map((frame) => frame.right)) + margin;
  const routeFor = (rail: number) =>
    compactOrthogonalPoints([
      start,
      { x: start.x, y: sourceEdge },
      { x: start.x, y: sourceEdge + directionSign * stub },
      { x: rail, y: sourceEdge + directionSign * stub },
      { x: rail, y: targetEdge - directionSign * stub },
      { x: end.x, y: targetEdge - directionSign * stub },
      end,
    ]);
  const rightRoute = routeFor(rightRail);
  const leftRoute = routeFor(leftRail);
  const points = routeClearsObstacles(rightRoute, obstacles)
    ? rightRoute
    : routeClearsObstacles(leftRoute, obstacles)
      ? leftRoute
      : rightRoute;
  return orthogonalEdge(points, {
    x: points === leftRoute ? leftRail : rightRail,
    y: (sourceEdge + targetEdge) / 2,
  });
}

function compactOrthogonalPoints(points: readonly CanvasPoint[]): CanvasPoint[] {
  const unique = points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const before = unique[index - 1]!;
    const after = unique[index + 1]!;
    return !(
      (before.x === point.x && point.x === after.x) ||
      (before.y === point.y && point.y === after.y)
    );
  });
}

function routeClearsObstacles(
  points: readonly CanvasPoint[],
  obstacles: readonly FrameBounds[],
): boolean {
  const padding = 10;
  return points.slice(1).every((point, index) => {
    const before = points[index]!;
    return obstacles.every((frame) => {
      if (before.y === point.y) {
        const left = Math.min(before.x, point.x);
        const right = Math.max(before.x, point.x);
        return !(
          before.y > frame.top - padding &&
          before.y < frame.bottom + padding &&
          right > frame.left - padding &&
          left < frame.right + padding
        );
      }
      const top = Math.min(before.y, point.y);
      const bottom = Math.max(before.y, point.y);
      return !(
        before.x > frame.left - padding &&
        before.x < frame.right + padding &&
        bottom > frame.top - padding &&
        top < frame.bottom + padding
      );
    });
  });
}

function orthogonalEdge(
  points: readonly CanvasPoint[],
  labelPoint: CanvasPoint,
): { path: string; labelPoint: CanvasPoint; startPoint: CanvasPoint; endPoint: CanvasPoint } {
  const start = points[0]!;
  let path = `M ${start.x} ${start.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[index + 1];
    if (!next) {
      path += ` L ${point.x} ${point.y}`;
      break;
    }
    const previous = points[index - 1]!;
    const incoming = Math.hypot(point.x - previous.x, point.y - previous.y);
    const outgoing = Math.hypot(next.x - point.x, next.y - point.y);
    const radius = Math.min(14, incoming / 2, outgoing / 2);
    const before = moveToward(point, previous, radius);
    const after = moveToward(point, next, radius);
    path += ` L ${before.x} ${before.y} Q ${point.x} ${point.y}, ${after.x} ${after.y}`;
  }
  return {
    path,
    labelPoint,
    startPoint: start,
    endPoint: points.at(-1)!,
  };
}

function moveToward(from: CanvasPoint, to: CanvasPoint, distance: number): CanvasPoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!length) return from;
  const amount = distance / length;
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  };
}

function cubicEdge(
  start: CanvasPoint,
  end: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
): { path: string; labelPoint: CanvasPoint; startPoint: CanvasPoint; endPoint: CanvasPoint } {
  return {
    path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`,
    labelPoint: {
      x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8,
      y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8,
    },
    startPoint: start,
    endPoint: end,
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
