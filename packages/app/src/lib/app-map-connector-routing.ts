import type { CanvasFrameBounds, CanvasPoint } from "./app-map-canvas-layout";

/** The four frame edges a connector can attach to. Kept local to the routing
 * core so its path search does not depend on persistence or rendering. */
export type ConnectorPortDirection = "left" | "right" | "top" | "bottom";

type RouteFrame = Pick<CanvasFrameBounds, "left" | "top" | "right" | "bottom">;

const ROUTE_STUB = 40;
const ROUTE_CLEARANCE = 20;
const ROUTE_EPSILON = 0.01;
const ROUTE_TURN_COST = 28;
/**
 * A recorded screen can have many actions that fan into later cards. Keep
 * their vertical/horizontal trunks close to the source and nested, rather
 * than letting every link choose an unrelated midpoint across the canvas.
 * This is deliberately world-space so it remains visually stable at every
 * zoom level.
 */
const ROUTE_SOURCE_FAN_SPREAD = 80;
/** A fan can turn closer to a target stub than a generic obstacle detour.
 * Keeping this small lets a near sibling reserve the outer rail without
 * forcing every later sibling through it. */
const ROUTE_FAN_TURN_CLEARANCE = 8;

type OrthogonalRouteInput = {
  start: CanvasPoint;
  end: CanvasPoint;
  sourceDirection: ConnectorPortDirection;
  targetDirection: ConnectorPortDirection;
  sourceFrame: RouteFrame;
  targetFrame: RouteFrame;
  /** Every screen frame is a soft routing obstacle. The source and
   * target frames are still included; the intentional anchor-to-edge and
   * edge-to-anchor pieces are added outside this route. */
  obstacleFrames: readonly RouteFrame[];
  sourceOffset?: number;
  targetOffset?: number;
  /** A computed source lane is render-only guidance. It uses a nested
   * source-side trunk so later sibling actions cannot cut through earlier
   * actions' routes. Authored offsets deliberately retain direct-lane
   * behavior. */
  automaticSourceLane?: boolean;
};

type RouteRect = RouteFrame;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function directionVector(direction: ConnectorPortDirection): CanvasPoint {
  if (direction === "left") return { x: -1, y: 0 };
  if (direction === "right") return { x: 1, y: 0 };
  if (direction === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function move(
  point: CanvasPoint,
  direction: ConnectorPortDirection,
  distance: number,
): CanvasPoint {
  const vector = directionVector(direction);
  return { x: point.x + vector.x * distance, y: point.y + vector.y * distance };
}

function isHorizontal(direction: ConnectorPortDirection): boolean {
  return direction === "left" || direction === "right";
}

function opposite(direction: ConnectorPortDirection): ConnectorPortDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

function equalPoint(left: CanvasPoint, right: CanvasPoint): boolean {
  return Math.abs(left.x - right.x) < ROUTE_EPSILON && Math.abs(left.y - right.y) < ROUTE_EPSILON;
}

/** Project a recorded interaction origin to the edge used by its route. A
 * source anchor can sit inside a screenshot; that first short segment is
 * intentional, while the rest of the connector remains outside cards. */
function projectToFrameEdge(
  point: CanvasPoint,
  frame: RouteFrame,
  direction: ConnectorPortDirection,
): CanvasPoint {
  if (direction === "left") {
    return { x: frame.left, y: clamp(point.y, frame.top, frame.bottom) };
  }
  if (direction === "right") {
    return { x: frame.right, y: clamp(point.y, frame.top, frame.bottom) };
  }
  if (direction === "top") {
    return { x: clamp(point.x, frame.left, frame.right), y: frame.top };
  }
  return { x: clamp(point.x, frame.left, frame.right), y: frame.bottom };
}

function normalizePoints(points: readonly CanvasPoint[]): CanvasPoint[] {
  const withoutDuplicates = points.filter(
    (point, index) => index === 0 || !equalPoint(point, points[index - 1]!),
  );
  return withoutDuplicates.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) return true;
    const previous = all[index - 1]!;
    const next = all[index + 1]!;
    const vertical =
      Math.abs(previous.x - point.x) < ROUTE_EPSILON && Math.abs(point.x - next.x) < ROUTE_EPSILON;
    const horizontal =
      Math.abs(previous.y - point.y) < ROUTE_EPSILON && Math.abs(point.y - next.y) < ROUTE_EPSILON;
    return !vertical && !horizontal;
  });
}

function expand(frame: RouteFrame): RouteRect {
  return {
    left: frame.left - ROUTE_CLEARANCE,
    right: frame.right + ROUTE_CLEARANCE,
    top: frame.top - ROUTE_CLEARANCE,
    bottom: frame.bottom + ROUTE_CLEARANCE,
  };
}

/** Only axis-aligned path sections enter this router. Touching the outer
 * clearance boundary is allowed; route rails are deliberately outside it. */
function segmentCrossesInterior(start: CanvasPoint, end: CanvasPoint, frame: RouteRect): boolean {
  if (Math.abs(start.x - end.x) < ROUTE_EPSILON) {
    if (start.x <= frame.left + ROUTE_EPSILON || start.x >= frame.right - ROUTE_EPSILON) {
      return false;
    }
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    return bottom > frame.top + ROUTE_EPSILON && top < frame.bottom - ROUTE_EPSILON;
  }
  if (Math.abs(start.y - end.y) < ROUTE_EPSILON) {
    if (start.y <= frame.top + ROUTE_EPSILON || start.y >= frame.bottom - ROUTE_EPSILON) {
      return false;
    }
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    return right > frame.left + ROUTE_EPSILON && left < frame.right - ROUTE_EPSILON;
  }
  // A diagonal is never a valid elbow section. Reject it rather than drawing
  // a visually plausible but impossible path through a card.
  return true;
}

function routeIsClear(points: readonly CanvasPoint[], obstacles: readonly RouteRect[]): boolean {
  return points.every(
    (point, index) =>
      index === 0 ||
      obstacles.every((obstacle) => !segmentCrossesInterior(points[index - 1]!, point, obstacle)),
  );
}

function routeLength(points: readonly CanvasPoint[]): number {
  return points.reduce(
    (total, point, index) =>
      index === 0
        ? total
        : total +
          Math.abs(point.x - points[index - 1]!.x) +
          Math.abs(point.y - points[index - 1]!.y),
    0,
  );
}

function routeScore(points: readonly CanvasPoint[]): number {
  return routeLength(points) + Math.max(0, points.length - 2) * ROUTE_TURN_COST;
}

function numericValues(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 1_000) / 1_000))].sort(
    (left, right) => left - right,
  );
}

function routeLane(sourceOffset?: number, targetOffset?: number): number {
  const values = [sourceOffset, targetOffset].filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  const average = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0.5;
  // Leave enough breathing room from the card corners for rounded turns and
  // allow automatic sibling lanes to occupy a stable, readable corridor.
  return clamp(average, 0.16, 0.84);
}

function facingLaneRoute(
  sourceStub: CanvasPoint,
  targetStub: CanvasPoint,
  sourceDirection: ConnectorPortDirection,
  targetDirection: ConnectorPortDirection,
  lane: number,
): CanvasPoint[] | undefined {
  if (targetDirection !== opposite(sourceDirection)) return undefined;
  if (isHorizontal(sourceDirection) && isHorizontal(targetDirection)) {
    const forwards =
      sourceDirection === "right"
        ? sourceStub.x < targetStub.x - ROUTE_EPSILON
        : sourceStub.x > targetStub.x + ROUTE_EPSILON;
    if (!forwards) return undefined;
    const railX = sourceStub.x + (targetStub.x - sourceStub.x) * lane;
    return [sourceStub, { x: railX, y: sourceStub.y }, { x: railX, y: targetStub.y }, targetStub];
  }
  if (!isHorizontal(sourceDirection) && !isHorizontal(targetDirection)) {
    const forwards =
      sourceDirection === "bottom"
        ? sourceStub.y < targetStub.y - ROUTE_EPSILON
        : sourceStub.y > targetStub.y + ROUTE_EPSILON;
    if (!forwards) return undefined;
    const railY = sourceStub.y + (targetStub.y - sourceStub.y) * lane;
    return [sourceStub, { x: sourceStub.x, y: railY }, { x: targetStub.x, y: railY }, targetStub];
  }
  return undefined;
}

/**
 * Build a nested source-side trunk for an automatic fan-out. Source lanes
 * follow captured action order when it exists, otherwise destination order.
 * Inverting their travel depth makes earlier links pass *outside* later
 * links. That prevents a lower branch's first horizontal segment from
 * crossing an earlier branch's vertical segment.
 *
 * This is intentionally used only for a computed source lane. It applies to
 * recorded and older label-only connections alike, while a person can still
 * pin an explicit route independently.
 */
function sourceFanRoute(
  sourceStub: CanvasPoint,
  targetStub: CanvasPoint,
  sourceDirection: ConnectorPortDirection,
  targetDirection: ConnectorPortDirection,
  sourceOffset: number | undefined,
): CanvasPoint[] | undefined {
  if (
    sourceOffset === undefined ||
    targetDirection !== opposite(sourceDirection) ||
    !Number.isFinite(sourceOffset)
  ) {
    return undefined;
  }
  const vector = directionVector(sourceDirection);
  const forwardDistance = isHorizontal(sourceDirection)
    ? (targetStub.x - sourceStub.x) * vector.x
    : (targetStub.y - sourceStub.y) * vector.y;
  if (forwardDistance <= ROUTE_EPSILON) return undefined;

  // Top/left destinations receive the outer track, lower/right destinations
  // the inner one. Measure the desired depth from the source *edge*, then
  // convert it back to the existing source stub. This is important for a
  // crowded fan: a near upper target can still claim its outer rail, while
  // later siblings turn at or inside their own source stub rather than
  // cutting across that rail. The final turn may sit close to a target stub;
  // that stub already provides the card-clearance distance.
  const lane = clamp(sourceOffset, 0.12, 0.88);
  const edgeDepth = ROUTE_FAN_TURN_CLEARANCE + (1 - lane) * ROUTE_SOURCE_FAN_SPREAD;
  const travel = Math.min(
    Math.max(0, edgeDepth - ROUTE_STUB),
    Math.max(0, forwardDistance - ROUTE_FAN_TURN_CLEARANCE),
  );
  const rail = {
    x: sourceStub.x + vector.x * travel,
    y: sourceStub.y + vector.y * travel,
  };
  if (isHorizontal(sourceDirection)) {
    return [sourceStub, { x: rail.x, y: sourceStub.y }, { x: rail.x, y: targetStub.y }, targetStub];
  }
  return [sourceStub, { x: sourceStub.x, y: rail.y }, { x: targetStub.x, y: rail.y }, targetStub];
}

/**
 * Finds the shortest stable path among a small set of orthogonal corridors.
 * It is intentionally not a heavyweight graph router: every candidate is
 * deterministic, has a bounded cost, and can be checked against all screen
 * frames on every render. That makes crowded maps feel direct while keeping
 * the routing core easy to replace with a more advanced router later.
 */
function routeAroundFrames(
  sourceStub: CanvasPoint,
  targetStub: CanvasPoint,
  sourceDirection: ConnectorPortDirection,
  targetDirection: ConnectorPortDirection,
  frames: readonly RouteFrame[],
): CanvasPoint[] {
  const obstacles = frames.map(expand);
  const candidates: CanvasPoint[][] = [];
  const add = (points: CanvasPoint[]) => {
    const normalized = normalizePoints(points);
    if (normalized.length >= 2 && routeIsClear(normalized, obstacles)) candidates.push(normalized);
  };

  add([sourceStub, targetStub]);
  add([sourceStub, { x: targetStub.x, y: sourceStub.y }, targetStub]);
  add([sourceStub, { x: sourceStub.x, y: targetStub.y }, targetStub]);

  const railDistance = ROUTE_STUB;
  const xRails = numericValues(
    frames.flatMap((frame) => [frame.left - railDistance, frame.right + railDistance]),
  );
  const yRails = numericValues(
    frames.flatMap((frame) => [frame.top - railDistance, frame.bottom + railDistance]),
  );
  for (const x of xRails) {
    add([sourceStub, { x, y: sourceStub.y }, { x, y: targetStub.y }, targetStub]);
  }
  for (const y of yRails) {
    add([sourceStub, { x: sourceStub.x, y }, { x: targetStub.x, y }, targetStub]);
  }

  // A blocked direct corridor can require going around both a row and a
  // column of cards. These four-corner candidates cover that without an
  // unbounded search and retain deterministic tie-breaking.
  const outerXs = numericValues([
    Math.min(...frames.map((frame) => frame.left)) - railDistance,
    Math.max(...frames.map((frame) => frame.right)) + railDistance,
  ]);
  const outerYs = numericValues([
    Math.min(...frames.map((frame) => frame.top)) - railDistance,
    Math.max(...frames.map((frame) => frame.bottom)) + railDistance,
  ]);
  for (const x of outerXs) {
    for (const y of outerYs) {
      add([sourceStub, { x, y: sourceStub.y }, { x, y }, { x: targetStub.x, y }, targetStub]);
      add([sourceStub, { x: sourceStub.x, y }, { x, y }, { x, y: targetStub.y }, targetStub]);
    }
  }

  // A pathological fully-packed or slightly overlapping map should still
  // yield an exterior elbow, never a backwards direct segment between two
  // opposing ports. The endpoint stubs can be temporarily trapped by their
  // own overlapping frames, so this deterministic last resort runs around
  // the union of every obstacle rather than pretending that short segment is
  // an intentional straight connector.
  if (!candidates.length) {
    return exteriorFallbackRoute(
      sourceStub,
      targetStub,
      sourceDirection,
      targetDirection,
      frames,
    );
  }
  return candidates.reduce((best, candidate) =>
    routeScore(candidate) < routeScore(best) ? candidate : best,
  );
}

function exteriorFallbackRoute(
  sourceStub: CanvasPoint,
  targetStub: CanvasPoint,
  sourceDirection: ConnectorPortDirection,
  targetDirection: ConnectorPortDirection,
  frames: readonly RouteFrame[],
): CanvasPoint[] {
  const left = Math.min(...frames.map((frame) => frame.left)) - ROUTE_STUB;
  const right = Math.max(...frames.map((frame) => frame.right)) + ROUTE_STUB;
  const top = Math.min(...frames.map((frame) => frame.top)) - ROUTE_STUB;
  const bottom = Math.max(...frames.map((frame) => frame.bottom)) + ROUTE_STUB;
  if (isHorizontal(sourceDirection)) {
    const sourceRailX = sourceDirection === "right" ? right : left;
    const targetRailX = targetDirection === "right" ? right : left;
    const topCost = Math.abs(sourceStub.y - top) + Math.abs(targetStub.y - top);
    const bottomCost = Math.abs(sourceStub.y - bottom) + Math.abs(targetStub.y - bottom);
    const railY = topCost <= bottomCost ? top : bottom;
    return normalizePoints([
      sourceStub,
      { x: sourceRailX, y: sourceStub.y },
      { x: sourceRailX, y: railY },
      { x: targetRailX, y: railY },
      { x: targetRailX, y: targetStub.y },
      targetStub,
    ]);
  }
  const sourceRailY = sourceDirection === "bottom" ? bottom : top;
  const targetRailY = targetDirection === "bottom" ? bottom : top;
  const leftCost = Math.abs(sourceStub.x - left) + Math.abs(targetStub.x - left);
  const rightCost = Math.abs(sourceStub.x - right) + Math.abs(targetStub.x - right);
  const railX = leftCost <= rightCost ? left : right;
  return normalizePoints([
    sourceStub,
    { x: sourceStub.x, y: sourceRailY },
    { x: railX, y: sourceRailY },
    { x: railX, y: targetRailY },
    { x: targetStub.x, y: targetRailY },
    targetStub,
  ]);
}

/**
 * Return the editable backbone for a FigJam-style bent connector. The path
 * leaves and enters at the selected edges, gives sibling links their own
 * deterministic lane when there is a clear corridor, then takes a short
 * obstacle-safe detour when that corridor is blocked.
 */
export function smartElbowPoints(input: OrthogonalRouteInput): CanvasPoint[] {
  const sourceExit = projectToFrameEdge(input.start, input.sourceFrame, input.sourceDirection);
  const sourceStub = move(sourceExit, input.sourceDirection, ROUTE_STUB);
  const targetStub = move(input.end, input.targetDirection, ROUTE_STUB);
  const obstacles = input.obstacleFrames.length
    ? input.obstacleFrames
    : [input.sourceFrame, input.targetFrame];
  const lane = facingLaneRoute(
    sourceStub,
    targetStub,
    input.sourceDirection,
    input.targetDirection,
    routeLane(input.sourceOffset, input.targetOffset),
  );
  const sourceFan = input.automaticSourceLane
    ? sourceFanRoute(
        sourceStub,
        targetStub,
        input.sourceDirection,
        input.targetDirection,
        input.sourceOffset,
      )
    : undefined;
  const route =
    sourceFan && routeIsClear(normalizePoints(sourceFan), obstacles.map(expand))
      ? normalizePoints(sourceFan)
      : lane && routeIsClear(normalizePoints(lane), obstacles.map(expand))
        ? normalizePoints(lane)
        : routeAroundFrames(
            sourceStub,
            targetStub,
            input.sourceDirection,
            input.targetDirection,
            obstacles,
          );
  return normalizePoints([input.start, sourceExit, ...route, targetStub, input.end]);
}
