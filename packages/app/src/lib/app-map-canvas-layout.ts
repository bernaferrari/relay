import type {
  CanvasInteractionAnchor as ProtocolCanvasInteractionAnchor,
  ConnectionPort,
  ConnectionPresentation,
} from "@relay/protocol";
import { smartElbowPoints, type ConnectorPortDirection } from "./app-map-connector-routing";
import type { MapTreeNode } from "./app-map-tree";
export { canvasEdgeArrowPath, canvasEdgeStartArrowPath } from "./app-map-canvas-arrows";
import {
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  SCREEN_FRAME_HEIGHT,
  SCREEN_FRAME_MIN_WIDTH,
  SCREEN_FRAME_TOP,
  canvasBounds,
  clampCanvasScale,
  fitCanvasViewport,
  nextBranchPosition,
  openCanvasViewport,
  screenCardGeometry,
  screenFrameBounds,
  screenMediaBounds,
  type CanvasFrameBounds,
  type CanvasFrameGeometry,
  type ScreenCardGeometry,
} from "./app-map-screen-layout";
import {
  DIRECT_PATH_EPSILON,
  cubicBackboneEdge,
  cubicEdge,
  cubicEdgeThroughMidpoint,
  cubicRouteAvoidsFrames,
  cubicRouteIsSafe,
  elbowEdge,
  lineCrossesFrameInterior,
  midpoint,
  pointAlongPolyline,
  sampleCubic,
  straightEdge,
} from "./app-map-canvas-edge-paths";

export {
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  SCREEN_FRAME_HEIGHT,
  SCREEN_FRAME_MIN_WIDTH,
  SCREEN_FRAME_TOP,
  canvasBounds,
  clampCanvasScale,
  fitCanvasViewport,
  nextBranchPosition,
  openCanvasViewport,
  screenCardGeometry,
  screenFrameBounds,
  screenMediaBounds,
};
export type { CanvasFrameBounds, CanvasFrameGeometry, ScreenCardGeometry };

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

type CanvasCubicSegment = {
  start: CanvasPoint;
  control1: CanvasPoint;
  control2: CanvasPoint;
  end: CanvasPoint;
};

export type CanvasEdgeGeometry = {
  path: string;
  labelPoint: CanvasPoint;
  startPoint: CanvasPoint;
  endPoint: CanvasPoint;
  /** Whether this is one free cubic that supports the visible drag anchor. */
  isEditableCurve: boolean;
  /** Exact analytic terminal tangent for a cubic; polylines use hit points. */
  endTangentPoint?: CanvasPoint;
  /** Analytic curve pieces retained for collision safety; hit points remain
   * intentionally light-weight so selection work stays inexpensive. */
  cubicSegments?: readonly CanvasCubicSegment[];
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
/** Keep the terminal arrow visually associated with its destination without
 * making it look like it pierces the screen/device frame. */
const CONNECTOR_TARGET_GAP = 12;
/** A nearly facing automatic pair should look like the single intentional
 * gesture it is, not a two-corner dogleg. Keep this in world space so the
 * decision does not flicker while the person zooms. */
const DIRECT_FACING_ALIGNMENT = 20;
const DIRECT_FACING_MIN_FORWARD_DISTANCE = 16;
const MIN_CUBIC_PULL = 8;
const FACING_CUBIC_HANDLE_FRACTION = 0.45;
/**
 * A very tall facing connection needs more than a mathematically horizontal
 * tangent at its destination. If its target handle stays proportional only
 * to the narrow horizontal gap, the last few pixels have to make the entire
 * turn and read as a J-hook. Let the terminal handle grow past that gap for
 * an extreme cross-axis span, while keeping the cubic monotone along the
 * selected port axis (0.45 / 1.2 is safely inside that bound).
 */
const FACING_TERMINAL_HANDLE_MAX_FRACTION = 1.2;
// Below 4:1 a regular facing cubic already turns naturally. This adjustment
// is deliberately reserved for the extreme near-column case that otherwise
// creates a tall J-hook.
const FACING_TERMINAL_BIAS_START_RATIO = 4;
const FACING_TERMINAL_BIAS_FULL_RATIO = 8;
/** The threshold at which the small facing gap cannot visually host a smooth
 * terminal turn. Beyond this ratio, use the exterior three-cubic arrival. */
const EXTREME_FACING_CROSS_AXIS_RATIO = 4;
const EXTREME_FACING_CORNER_MIN = 56;
// Keep the extreme fallback broad enough to avoid a terminal hook, but a
// moderately tighter than the initial 120px radius so its final turn reads
// as a deliberate, slightly steeper arrival rather than a wide U.
const EXTREME_FACING_CORNER_MAX = 112;
const QUARTER_ELLIPSE_HANDLE = 0.5522847498;
// The source must get beyond its own displayed frame before an exterior rail
// can come back across the narrow forward gap. Keep a small actual trunk too,
// rather than merging both quarter turns into another long S-shaped cubic.
const EXTREME_FACING_ENTRY_CLEARANCE = SCREEN_FRAME_HEIGHT + 16;
const EXTREME_FACING_MIN_TRUNK = 24;
const PERPENDICULAR_HANDLE_FRACTION = 0.5522847498;
const SAME_SIDE_CURVE_RAIL_CLEARANCE = 32;
const CURVE_OFFSET_EPSILON = 0.01;
/** Ignore sub-pixel-to-a-few-pixel pointer noise on a computed source fan.
 * This is presentation behavior, never a migration or persistence rewrite. */
const AUTOMATIC_FAN_CURVE_JITTER_RADIUS = 8;

/**
 * Resolve the terminal clearance in canvas/world coordinates.
 *
 * Connector paths, endpoint tangents, and arrowheads are all canvas
 * geometry, so their inputs must not depend on the current camera zoom. A
 * screen-pixel gap used to move the endpoint whenever the viewport scale
 * changed, which made an otherwise stationary arrow visibly redraw into a
 * different shape. Keep this exported compatibility boundary because scene,
 * minimap, and presence all call it, but deliberately ignore its scale.
 */
export function connectorTargetGapForViewport(_viewportScale?: number): number {
  return CONNECTOR_TARGET_GAP;
}

export function canvasEdgeGeometry(
  edge: {
    from: string;
    to: string;
    kind: "forward" | "return";
    sourceAnchor?: CanvasInteractionAnchor;
    sourceRotation?: CanvasScreenRotation;
    presentation?: ConnectionPresentation;
    /** Computed, render-only source fan provenance. Never persisted. */
    automaticSourceLane?: boolean;
    /** Render-only world-space clearance for the terminal arrowhead. */
    targetGap?: number;
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
      isEditableCurve: false,
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
  const fromMedia = screenMediaBounds(fromPosition, fromGeometry);
  const toFrame = screenFrameBounds(toPosition, toGeometry);
  const automaticPorts = autoConnectorPortPair(fromFrame, toFrame);
  const direction = explicitPort(edge.presentation?.sourcePort) ?? automaticPorts.source;
  const targetDirection = explicitPort(edge.presentation?.targetPort) ?? automaticPorts.target;
  // Source attachment is an interaction contract, not a routing convenience:
  // recorded evidence leaves from its real control; every other connection
  // leaves from the exact centre of the chosen source edge. Computed fan
  // lanes are still passed into `smartElbowPoints` below, where they choose
  // an exterior rail without making an unrecorded arrow appear to start from
  // an arbitrary spot on the card.
  const defaultStart = portPoint(fromFrame, direction);
  const start = sourcePoint
    ? {
        x: fromMedia.left + Math.max(0, Math.min(1, sourcePoint.x)) * fromGeometry.mediaWidth,
        y: fromMedia.top + Math.max(0, Math.min(1, sourcePoint.y)) * fromGeometry.mediaHeight,
      }
    : defaultStart;
  // A connector always arrives at the centre of its chosen target edge. Fan
  // lanes may guide the route before its terminal segment, but they never
  // obscure where the arrow actually lands on the destination screen.
  const targetAttachment = portPoint(toFrame, targetDirection);
  const targetVector = portDirectionVector(targetDirection);
  // Match FigJam's deliberate air gap: the arrow tip stops just outside the
  // target rather than painting into the screen preview. The route still uses
  // the chosen target side for its final tangent.
  const targetGap =
    edge.targetGap !== undefined && Number.isFinite(edge.targetGap) && edge.targetGap >= 0
      ? edge.targetGap
      : CONNECTOR_TARGET_GAP;
  const end = {
    x: targetAttachment.x + targetVector.x * targetGap,
    y: targetAttachment.y + targetVector.y * targetGap,
  };
  const route = edge.presentation?.route ?? "elbow";
  const framedNodes = nodes.map((node) => ({
    id: node.id,
    frame: screenFrameBounds(positionFor(node), geometryFor?.(node) ?? screenCardGeometry()),
  }));
  const elbowPoints = () =>
    smartElbowPoints({
      start,
      end,
      sourceDirection: direction,
      targetDirection,
      sourceFrame: fromFrame,
      targetFrame: toFrame,
      obstacleFrames: framedNodes.map((node) => node.frame),
      sourceOffset: edge.presentation?.sourceOffset,
      // Target offsets are internal rail hints only. The visible terminal
      // above remains centred regardless of legacy or computed lane data.
      targetOffset: edge.presentation?.targetOffset,
      automaticSourceLane: edge.automaticSourceLane,
    });
  if (route === "straight") return straightEdge(start, end);
  // A singleton automatic connection that is already aligned with its
  // opposing target edge does not need a cosmetic elbow. Keep computed fan
  // lanes on their reserved nested trunks: selecting a shortest route for an
  // individual fan member would make it cut through a sibling's rail.
  if (
    route === "elbow" &&
    edge.presentation?.sourceOffset === undefined &&
    !edge.automaticSourceLane &&
    directFacingPathIsClear(
      start,
      end,
      direction,
      targetDirection,
      from.id,
      to.id,
      nodes,
      positionFor,
      geometryFor,
    )
  ) {
    return straightEdge(start, end);
  }
  if (route === "elbow") return elbowEdge(elbowPoints());

  const offset = edge.presentation?.controlOffset;
  // Curve is an explicit selected route. On an automatic fan, a default or
  // tiny pointer-jitter offset becomes a visibly smoother compound cubic
  // along the reserved no-crossing backbone—not a Bent/Q route that appears
  // unchanged until someone drags an anchor. A meaningful anchor movement
  // remains a free authored cubic below.
  if (edge.automaticSourceLane && !hasMeaningfulAutomaticFanCurveOffset(offset)) {
    return cubicBackboneEdge(elbowPoints());
  }
  // With an extreme cross-axis span and only a sliver of forward clearance,
  // a single facing cubic has no room to both turn naturally and arrive on
  // the chosen target normal. That is the classic last-moment J-hook: the
  // arrow tangent is technically right, but the curve has to make its entire
  // turn in a handful of pixels. Use a generated three-cubic spline instead:
  // horizontal exit → vertical trunk → wide horizontal arrival. Its outer
  // joins are C¹-continuous, so the terminal never becomes a last-moment
  // J-hook or a hidden straight rail.
  const extremeFacing = extremeFacingCurve(start, end, direction, targetDirection);
  if (extremeFacing && cubicRouteAvoidsFrames(extremeFacing, from.id, to.id, framedNodes)) {
    return extremeFacing;
  }
  const controls = normalCubicControls(start, end, direction, targetDirection);
  if (!controls) return cubicBackboneEdge(elbowPoints());
  const baseCurve = cubicEdge(start, end, controls.control1, controls.control2);
  const isSafe = (candidate: CanvasEdgeGeometry) =>
    cubicRouteIsSafe(candidate, from.id, to.id, framedNodes, direction, targetDirection);
  if (!isSafe(baseCurve)) return cubicBackboneEdge(elbowPoints());

  // A center-anchor drag cannot move either normal handle independently
  // without breaking a cardinal departure or arrival. Split the normal cubic
  // at its midpoint and move only the C2-continuous join instead. A strongly
  // cross-axis facing pair deliberately starts at its geometric centre rather
  // than the biased cubic's parametric midpoint: the stored offset is a
  // person-facing canvas displacement, so changing the terminal pull must
  // never make an existing draggable anchor jump sideways.
  const anchorOrigin = controls.usesStableMidpoint ? midpoint(start, end) : baseCurve.labelPoint;
  const requestedOffset = offset ?? { x: 0, y: 0 };
  const needsShapedMidpoint =
    controls.usesStableMidpoint ||
    Math.hypot(requestedOffset.x, requestedOffset.y) > CURVE_OFFSET_EPSILON;
  if (!needsShapedMidpoint) return baseCurve;
  const shapedAt = (fraction: number) =>
    cubicEdgeThroughMidpoint(start, end, controls.control1, controls.control2, {
      x: anchorOrigin.x + requestedOffset.x * fraction,
      y: anchorOrigin.y + requestedOffset.y * fraction,
    });
  const requested = shapedAt(1);
  if (isSafe(requested)) return requested;
  let minimum = 0;
  let maximum = 1;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (minimum + maximum) / 2;
    if (isSafe(shapedAt(middle))) minimum = middle;
    else maximum = middle;
  }
  return minimum > CURVE_OFFSET_EPSILON ? shapedAt(minimum) : baseCurve;
}

type EdgePortDirection = ConnectorPortDirection;

function explicitPort(port: ConnectionPort | undefined): EdgePortDirection | undefined {
  return port && port !== "auto" ? port : undefined;
}

function fallbackAutoPortDirection(
  from: CanvasFrameBounds,
  to: CanvasFrameBounds,
): EdgePortDirection {
  if (to.left >= from.right) return "right";
  if (to.right <= from.left) return "left";
  if (to.top >= from.bottom) return "bottom";
  if (to.bottom <= from.top) return "top";

  const dx = to.centerX - from.centerX;
  const dy = to.centerY - from.centerY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/**
 * Pick the semantic automatic port pair from the real visible frames. A card
 * arranged to the right remains a right→left connection even when it sits
 * lower on the canvas: that preserves the diagram's reading direction and
 * keeps a left-side target attachment when the user expects it. Explicit
 * endpoint ports bypass this chooser.
 */
export function autoConnectorPortPair(
  from: CanvasFrameBounds,
  to: CanvasFrameBounds,
): { source: EdgePortDirection; target: EdgePortDirection } {
  if (to.left >= from.right) return { source: "right", target: "left" };
  if (to.right <= from.left) return { source: "left", target: "right" };
  if (to.top >= from.bottom) return { source: "bottom", target: "top" };
  if (to.bottom <= from.top) return { source: "top", target: "bottom" };
  // A slight card overlap makes the normal facing side physically
  // impossible: its source attachment would already be inside the target
  // (or vice versa). This is the one automatic exception to the diagram's
  // usual reading direction. Pick a valid exterior pair instead of drawing
  // a backwards line through a screen. Explicit ports never reach here.
  const exterior = overlappingFramePortPair(from, to);
  if (exterior) return exterior;
  const source = fallbackAutoPortDirection(from, to);
  return { source, target: oppositePortDirection(source) };
}

type OverlapPortCandidate = {
  source: EdgePortDirection;
  target: EdgePortDirection;
  score: number;
};

function overlappingFramePortPair(
  from: CanvasFrameBounds,
  to: CanvasFrameBounds,
): { source: EdgePortDirection; target: EdgePortDirection } | undefined {
  const directions: EdgePortDirection[] = ["bottom", "top", "left", "right"];
  const candidates: OverlapPortCandidate[] = [];
  for (const source of directions) {
    const sourcePoint = portPoint(from, source);
    if (pointIsInsideFrame(sourcePoint, to)) continue;
    for (const target of directions) {
      const targetPoint = portPoint(to, target);
      if (pointIsInsideFrame(targetPoint, from)) continue;
      const sourceVector = portDirectionVector(source);
      const forward =
        (targetPoint.x - sourcePoint.x) * sourceVector.x +
        (targetPoint.y - sourcePoint.y) * sourceVector.y;
      const opposing = target === oppositePortDirection(source);
      const bends = opposing && forward > DIRECT_PATH_EPSILON ? 2 : opposing ? 4 : 3;
      const clearance = Math.min(
        portOutwardClearance(sourcePoint, source, to),
        portOutwardClearance(targetPoint, target, from),
      );
      // Prioritize a clear outward exit, then fewer bends, then a compact
      // route. The stable direction order above breaks true geometric ties.
      const clearancePenalty = Number.isFinite(clearance)
        ? Math.max(0, DIRECT_FACING_MIN_FORWARD_DISTANCE - clearance)
        : 0;
      candidates.push({
        source,
        target,
        score:
          clearancePenalty * 100_000 +
          bends * 1_000 +
          Math.abs(targetPoint.x - sourcePoint.x) +
          Math.abs(targetPoint.y - sourcePoint.y),
      });
    }
  }
  if (!candidates.length) return undefined;
  const best = candidates.reduce((current, candidate) =>
    candidate.score < current.score ? candidate : current,
  );
  return { source: best.source, target: best.target };
}

function pointIsInsideFrame(point: CanvasPoint, frame: CanvasFrameBounds): boolean {
  return (
    point.x > frame.left + DIRECT_PATH_EPSILON &&
    point.x < frame.right - DIRECT_PATH_EPSILON &&
    point.y > frame.top + DIRECT_PATH_EPSILON &&
    point.y < frame.bottom - DIRECT_PATH_EPSILON
  );
}

/** Distance available while leaving a port before the route would run into
 * another frame. Infinity means the port immediately heads away from it. */
function portOutwardClearance(
  point: CanvasPoint,
  direction: EdgePortDirection,
  frame: CanvasFrameBounds,
): number {
  if (direction === "right") {
    return point.y > frame.top && point.y < frame.bottom && point.x <= frame.left
      ? frame.left - point.x
      : Infinity;
  }
  if (direction === "left") {
    return point.y > frame.top && point.y < frame.bottom && point.x >= frame.right
      ? point.x - frame.right
      : Infinity;
  }
  if (direction === "bottom") {
    return point.x > frame.left && point.x < frame.right && point.y <= frame.top
      ? frame.top - point.y
      : Infinity;
  }
  return point.x > frame.left && point.x < frame.right && point.y >= frame.bottom
    ? point.y - frame.bottom
    : Infinity;
}

function oppositePortDirection(direction: EdgePortDirection): EdgePortDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

function portDirectionVector(direction: EdgePortDirection): CanvasPoint {
  if (direction === "left") return { x: -1, y: 0 };
  if (direction === "right") return { x: 1, y: 0 };
  if (direction === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
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

/** Return the available distance in the source's forward direction when a
 * cubic enters through the opposing target port. Undefined means a cubic
 * would need to reverse direction before arriving, which is not a safe
 * default shape. */
function cubicForwardDistance(
  start: CanvasPoint,
  end: CanvasPoint,
  sourceDirection: EdgePortDirection,
  targetDirection: EdgePortDirection,
): number | undefined {
  if (targetDirection !== oppositePortDirection(sourceDirection)) return undefined;
  const vector = portDirectionVector(sourceDirection);
  const distance = (end.x - start.x) * vector.x + (end.y - start.y) * vector.y;
  return distance > DIRECT_PATH_EPSILON ? distance : undefined;
}

function hasMeaningfulAutomaticFanCurveOffset(offset: CanvasPoint | undefined): boolean {
  return offset !== undefined && Math.hypot(offset.x, offset.y) > AUTOMATIC_FAN_CURVE_JITTER_RADIUS;
}

type NormalCubicControls = {
  control1: CanvasPoint;
  control2: CanvasPoint;
  /** Preserve the logical centre anchor while a target-side pull is biased. */
  usesStableMidpoint?: boolean;
};

function dot(left: CanvasPoint, right: CanvasPoint): number {
  return left.x * right.x + left.y * right.y;
}

function subtract(left: CanvasPoint, right: CanvasPoint): CanvasPoint {
  return { x: left.x - right.x, y: left.y - right.y };
}

function moveAlong(point: CanvasPoint, direction: CanvasPoint, distance: number): CanvasPoint {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function leftNormal(direction: CanvasPoint): CanvasPoint {
  return { x: -direction.y, y: direction.x };
}

/**
 * Solve a one-cubic connector only when both endpoint tangents can stay on
 * their selected port normals. Facing handles are ordered strictly along the
 * shared forward axis; perpendicular handles use the corresponding source
 * and target projections, producing the familiar quarter-turn proportions.
 * Same-side pairs use one shared exterior rail when they have real cross-axis
 * separation; backwards and cramped pairs deliberately use the router's
 * backbone instead of creating an S-loop or a diagonal screen departure.
 */
function normalCubicControls(
  start: CanvasPoint,
  end: CanvasPoint,
  sourceDirection: EdgePortDirection,
  targetDirection: EdgePortDirection,
): NormalCubicControls | undefined {
  const sourceVector = portDirectionVector(sourceDirection);
  const targetVector = portDirectionVector(targetDirection);
  const chord = subtract(end, start);
  if (targetDirection === oppositePortDirection(sourceDirection)) {
    const forwardDistance = dot(chord, sourceVector);
    if (forwardDistance < DIRECT_FACING_MIN_FORWARD_DISTANCE) return undefined;
    // Keep the source pull compact so an anchored origin leaves its screen
    // decisively. The target pull is allowed to grow for an overwhelmingly
    // cross-axis connection: this starts the final turn early enough that a
    // left-side arrival remains one continuous fluid curve instead of a long
    // vertical stroke followed by a last-moment J-hook. The chosen 1.2× cap
    // remains monotone with the source's 0.375–0.45× pull range, so the route
    // never doubles back through its selected facing ports.
    const minimumHandle = Math.min(MIN_CUBIC_PULL, forwardDistance / 4);
    const maximumHandle = Math.max(0, (forwardDistance - minimumHandle) / 2);
    const sourceHandle = Math.min(
      Math.max(minimumHandle, forwardDistance * FACING_CUBIC_HANDLE_FRACTION),
      maximumHandle,
    );
    const crossAxisDistance = Math.abs(dot(chord, leftNormal(sourceVector)));
    const crossAxisRatio = crossAxisDistance / Math.max(forwardDistance, DIRECT_PATH_EPSILON);
    const terminalBias = Math.max(
      0,
      Math.min(
        1,
        (crossAxisRatio - FACING_TERMINAL_BIAS_START_RATIO) /
          (FACING_TERMINAL_BIAS_FULL_RATIO - FACING_TERMINAL_BIAS_START_RATIO),
      ),
    );
    const targetHandle =
      forwardDistance *
      (FACING_CUBIC_HANDLE_FRACTION +
        (FACING_TERMINAL_HANDLE_MAX_FRACTION - FACING_CUBIC_HANDLE_FRACTION) * terminalBias);
    return {
      control1: moveAlong(start, sourceVector, sourceHandle),
      control2: moveAlong(end, targetVector, targetHandle),
      usesStableMidpoint: terminalBias > CURVE_OFFSET_EPSILON,
    };
  }
  if (targetDirection === sourceDirection) {
    const perpendicular = leftNormal(sourceVector);
    const forwardDistance = dot(chord, sourceVector);
    const crossDistance = dot(chord, perpendicular);
    // A same-side connector with no meaningful cross-axis separation would
    // retrace itself through one cubic. Use the router's rounded exterior U
    // in that case; otherwise the common outside rail produces a clean,
    // normal-constrained loop without touching either screen.
    if (Math.abs(crossDistance) < DIRECT_FACING_MIN_FORWARD_DISTANCE) return undefined;
    const sourceHandle =
      Math.max(0, forwardDistance) +
      SAME_SIDE_CURVE_RAIL_CLEARANCE +
      PERPENDICULAR_HANDLE_FRACTION * Math.abs(crossDistance);
    const targetHandle = sourceHandle - forwardDistance;
    return {
      control1: moveAlong(start, sourceVector, sourceHandle),
      control2: moveAlong(end, targetVector, targetHandle),
    };
  }

  // Perpendicular ports have two independent forward distances: the chord
  // must be in front of the source normal and the source must sit outward of
  // the target normal. Otherwise a one-cubic turn would reverse or curl back
  // through a screen.
  const sourceProjection = dot(chord, sourceVector);
  const targetProjection = dot(subtract(start, end), targetVector);
  if (
    sourceProjection < DIRECT_FACING_MIN_FORWARD_DISTANCE ||
    targetProjection < DIRECT_FACING_MIN_FORWARD_DISTANCE
  ) {
    return undefined;
  }
  return {
    control1: moveAlong(start, sourceVector, sourceProjection * PERPENDICULAR_HANDLE_FRACTION),
    control2: moveAlong(end, targetVector, targetProjection * PERPENDICULAR_HANDLE_FRACTION),
  };
}

/**
 * Build the fluid fallback for a very tall (or very wide) facing connector.
 *
 * A normal single cubic has only the narrow source→target clearance in which
 * to turn. When that clearance is dwarfed by the cross-axis distance, its
 * tangent may be mathematically correct but it still reads as a sharp hook.
 * This construction gives the terminal a real quarter-ellipse: its final
 * control is materially behind the arrow on the selected incoming axis. A
 * first horizontal-to-cross-axis turn, a genuinely vertical middle cubic,
 * and a final cross-axis-to-horizontal turn are C¹-continuous at both joins.
 * It is the same visual grammar as a FigJam curved connector, expressed with
 * plain SVG cubics so selection, arrows, and collision safety share one
 * geometry.
 */
function extremeFacingCurve(
  start: CanvasPoint,
  end: CanvasPoint,
  sourceDirection: EdgePortDirection,
  targetDirection: EdgePortDirection,
): CanvasEdgeGeometry | undefined {
  if (targetDirection !== oppositePortDirection(sourceDirection)) return undefined;
  const sourceVector = portDirectionVector(sourceDirection);
  const crossAxis = leftNormal(sourceVector);
  const chord = subtract(end, start);
  const forwardDistance = dot(chord, sourceVector);
  const signedCrossDistance = dot(chord, crossAxis);
  const crossDistance = Math.abs(signedCrossDistance);
  if (
    forwardDistance < DIRECT_FACING_MIN_FORWARD_DISTANCE ||
    crossDistance / Math.max(forwardDistance, DIRECT_PATH_EPSILON) < EXTREME_FACING_CROSS_AXIS_RATIO
  ) {
    return undefined;
  }

  const travelVector = moveAlong({ x: 0, y: 0 }, crossAxis, signedCrossDistance >= 0 ? 1 : -1);
  // A fixed bounded terminal width is intentional. It produces a visible,
  // stable curve at every placement without letting an enormous vertical gap
  // balloon the last corner across unrelated cards. It can exceed the tiny
  // forward gap: that is the exterior rail which gives the arrow a material
  // horizontal arrival instead of an unavoidable compressed hook.
  const desiredTerminalWidth = Math.min(
    EXTREME_FACING_CORNER_MAX,
    Math.max(EXTREME_FACING_CORNER_MIN, crossDistance * 0.12),
  );
  // Reserve enough vertical trunk that its two matching join handles never
  // reverse through each other. Otherwise a medium-height route could turn
  // the supposedly straight middle section into a second small S-curve.
  // On cramped geometry this scales both corners down together; if that
  // makes the terminal imperceptible, the collision-safe router is the
  // honest fallback.
  const minimumTrunk = Math.min(EXTREME_FACING_MIN_TRUNK, crossDistance / 3);
  const desiredEntryTurn = Math.max(desiredTerminalWidth, EXTREME_FACING_ENTRY_CLEARANCE);
  const availableTurnDistance = Math.max(
    0,
    (crossDistance - minimumTrunk) / (1 + QUARTER_ELLIPSE_HANDLE),
  );
  const turnScale = Math.min(1, availableTurnDistance / (desiredEntryTurn + desiredTerminalWidth));
  const terminalWidth = desiredTerminalWidth * turnScale;
  const terminalTurn = terminalWidth;
  const entryTurn = desiredEntryTurn * turnScale;
  const trunkLength = crossDistance - entryTurn - terminalTurn;
  if (
    terminalWidth <= MIN_CUBIC_PULL ||
    terminalTurn <= DIRECT_PATH_EPSILON ||
    entryTurn <= DIRECT_PATH_EPSILON ||
    trunkLength <= DIRECT_PATH_EPSILON
  ) {
    return undefined;
  }

  // `rail` deliberately sits behind the target by terminalWidth. For a very
  // narrow forward gap it can be outside the start/end x interval; that is
  // required to make a broad rightward arrival while preserving both chosen
  // horizontal port normals.
  const rail = moveAlong(end, sourceVector, -terminalWidth);
  const entryEnd = moveAlong(rail, travelVector, -(crossDistance - entryTurn));
  const terminalStart = moveAlong(rail, travelVector, -terminalTurn);
  const sourceLead = terminalWidth;
  const entryControl1 = moveAlong(start, sourceVector, sourceLead);
  const entryControl2 = moveAlong(entryEnd, travelVector, -QUARTER_ELLIPSE_HANDLE * entryTurn);
  const trunkControl1 = moveAlong(entryEnd, travelVector, QUARTER_ELLIPSE_HANDLE * entryTurn);
  const trunkControl2 = moveAlong(
    terminalStart,
    travelVector,
    -QUARTER_ELLIPSE_HANDLE * terminalTurn,
  );
  const terminalControl1 = moveAlong(
    terminalStart,
    travelVector,
    QUARTER_ELLIPSE_HANDLE * terminalTurn,
  );
  const terminalControl2 = moveAlong(end, sourceVector, -QUARTER_ELLIPSE_HANDLE * terminalWidth);
  const entrySamples = sampleCubic(start, entryControl1, entryControl2, entryEnd);
  const trunkSamples = sampleCubic(entryEnd, trunkControl1, trunkControl2, terminalStart);
  const terminalSamples = sampleCubic(terminalStart, terminalControl1, terminalControl2, end);
  const hitPoints = [...entrySamples, ...trunkSamples.slice(1), ...terminalSamples.slice(1)];
  return {
    path: `M ${start.x} ${start.y} C ${entryControl1.x} ${entryControl1.y}, ${entryControl2.x} ${entryControl2.y}, ${entryEnd.x} ${entryEnd.y} C ${trunkControl1.x} ${trunkControl1.y}, ${trunkControl2.x} ${trunkControl2.y}, ${terminalStart.x} ${terminalStart.y} C ${terminalControl1.x} ${terminalControl1.y}, ${terminalControl2.x} ${terminalControl2.y}, ${end.x} ${end.y}`,
    labelPoint: pointAlongPolyline(hitPoints, 0.5),
    startPoint: start,
    endPoint: end,
    // This is a generated safety route. Exposing a midpoint handle would
    // misleadingly imply that a person must fix the terminal curve manually.
    isEditableCurve: false,
    endTangentPoint: terminalControl2,
    cubicSegments: [
      { start, control1: entryControl1, control2: entryControl2, end: entryEnd },
      {
        start: entryEnd,
        control1: trunkControl1,
        control2: trunkControl2,
        end: terminalStart,
      },
      {
        start: terminalStart,
        control1: terminalControl1,
        control2: terminalControl2,
        end,
      },
    ],
    hitPoints,
  };
}

/**
 * Decide whether an automatic facing pair can be rendered as one deliberate
 * line. This is intentionally stricter than generic collision routing: it
 * only handles a near-aligned pair, and it never bypasses a computed source
 * fan lane. That makes the short direct route safe without sacrificing the
 * deterministic no-crossing invariant of a fan-out.
 */
function directFacingPathIsClear(
  start: CanvasPoint,
  end: CanvasPoint,
  sourceDirection: EdgePortDirection,
  targetDirection: EdgePortDirection,
  sourceId: string,
  targetId: string,
  nodes: readonly MapTreeNode[],
  positionFor: (node: MapTreeNode) => CanvasPoint,
  geometryFor: ((node: MapTreeNode) => ScreenCardGeometry) | undefined,
): boolean {
  if (targetDirection !== oppositePortDirection(sourceDirection)) return false;
  if (
    (cubicForwardDistance(start, end, sourceDirection, targetDirection) ?? 0) <
    DIRECT_FACING_MIN_FORWARD_DISTANCE
  ) {
    return false;
  }
  const crossAxisDistance =
    sourceDirection === "left" || sourceDirection === "right"
      ? Math.abs(start.y - end.y)
      : Math.abs(start.x - end.x);
  if (crossAxisDistance > DIRECT_FACING_ALIGNMENT) return false;
  return nodes.every((node) => {
    if (node.id === sourceId || node.id === targetId) return true;
    return !lineCrossesFrameInterior(
      start,
      end,
      screenFrameBounds(positionFor(node), geometryFor?.(node) ?? screenCardGeometry()),
    );
  });
}

/** Strict line-vs-rectangle test. Endpoints on an edge are not considered a
 * collision, but entering a third screen's visible frame is. This supports
 * the tiny direct-route fast path above; the general router still handles
 * all longer obstacle detours with its normal clearance rails. */
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
