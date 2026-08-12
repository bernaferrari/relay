import type {
  CanvasInteractionAnchor as ProtocolCanvasInteractionAnchor,
  CanvasNote,
  ConnectionPort,
  ConnectionPresentation,
} from "@relay/protocol";
import { smartElbowPoints, type ConnectorPortDirection } from "./app-map-connector-routing";
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
export function canvasEdgeArrowPath(
  geometry: Pick<CanvasEdgeGeometry, "endPoint" | "endTangentPoint" | "hitPoints">,
  strokeWidth = 2,
): string {
  const end = geometry.endPoint;
  const exactTangent = geometry.endTangentPoint;
  const tangentPoint =
    exactTangent && Math.hypot(end.x - exactTangent.x, end.y - exactTangent.y) > 0.01
      ? exactTangent
      : previousDistinctPoint(geometry.hitPoints, end);
  return tangentPoint ? arrowPathAt(end, tangentPoint, strokeWidth) : "";
}

/** Same geometry as the terminal arrow, mirrored onto the source endpoint.
 * Separating it from rendering means adding or removing arrowheads does not
 * alter the route, its hit path, or any persisted endpoint attachment. */
export function canvasEdgeStartArrowPath(
  geometry: Pick<CanvasEdgeGeometry, "startPoint" | "hitPoints">,
  strokeWidth = 2,
): string {
  const start = geometry.startPoint;
  const nextPoint = nextDistinctPoint(geometry.hitPoints, start);
  return nextPoint ? arrowPathAt(start, nextPoint, strokeWidth) : "";
}

function previousDistinctPoint(points: readonly CanvasPoint[], endpoint: CanvasPoint) {
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const candidate = points[index]!;
    if (Math.hypot(endpoint.x - candidate.x, endpoint.y - candidate.y) > 0.01) return candidate;
  }
  return undefined;
}

function nextDistinctPoint(points: readonly CanvasPoint[], endpoint: CanvasPoint) {
  for (let index = 1; index < points.length; index += 1) {
    const candidate = points[index]!;
    if (Math.hypot(endpoint.x - candidate.x, endpoint.y - candidate.y) > 0.01) return candidate;
  }
  return undefined;
}

function arrowPathAt(tip: CanvasPoint, tangentPoint: CanvasPoint, strokeWidth: number): string {
  const deltaX = tip.x - tangentPoint.x;
  const deltaY = tip.y - tangentPoint.y;
  const distance = Math.hypot(deltaX, deltaY);
  const tangentX = deltaX / distance;
  const tangentY = deltaY / distance;
  const normalX = -tangentY;
  const normalY = tangentX;
  const extraWeight = Math.max(0, strokeWidth - 1);
  // Figma's line arrow is two 45° strokes at the path endpoint. One shared
  // projection keeps both wings equal instead of producing a narrow, swept
  // chevron whose terminal can look hooked on a shallow curve.
  const wing = 7 + extraWeight * 0.75;
  const baseX = tip.x - tangentX * wing;
  const baseY = tip.y - tangentY * wing;
  const first = {
    x: baseX + normalX * wing,
    y: baseY + normalY * wing,
  };
  const second = {
    x: baseX - normalX * wing,
    y: baseY - normalY * wing,
  };

  return `M ${first.x} ${first.y} L ${tip.x} ${tip.y} L ${second.x} ${second.y}`;
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
/** Keep the terminal arrow visually associated with its destination without
 * making it look like it pierces the screen/device frame. */
const CONNECTOR_TARGET_GAP = 12;
/** A nearly facing automatic pair should look like the single intentional
 * gesture it is, not a two-corner dogleg. Keep this in world space so the
 * decision does not flicker while the person zooms. */
const DIRECT_FACING_ALIGNMENT = 20;
const DIRECT_PATH_EPSILON = 0.01;
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
const CUBIC_HIT_POINT_COUNT = 33;
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

/** The actual screenshot rectangle inside a screen frame. Portrait previews
 * may reserve a small horizontal gutter so a very narrow device remains
 * legible; interaction anchors must use this media box rather than the wider
 * card frame or the highlighted action and its connector will drift apart. */
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
  const defaultStart = portPoint(fromFrame, direction, edge.presentation?.sourceOffset);
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
function lineCrossesFrameInterior(
  start: CanvasPoint,
  end: CanvasPoint,
  frame: CanvasFrameBounds,
): boolean {
  const intervalForAxis = (
    origin: number,
    delta: number,
    minimum: number,
    maximum: number,
  ): [number, number] => {
    if (Math.abs(delta) < DIRECT_PATH_EPSILON) {
      return origin > minimum + DIRECT_PATH_EPSILON && origin < maximum - DIRECT_PATH_EPSILON
        ? [-Infinity, Infinity]
        : [Infinity, -Infinity];
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    return [Math.min(first, second), Math.max(first, second)];
  };
  const x = intervalForAxis(start.x, end.x - start.x, frame.left, frame.right);
  const y = intervalForAxis(start.y, end.y - start.y, frame.top, frame.bottom);
  const entersAt = Math.max(0, x[0], y[0]);
  const exitsAt = Math.min(1, x[1], y[1]);
  return entersAt < exitsAt - DIRECT_PATH_EPSILON;
}

function polylineEntersFrame(points: readonly CanvasPoint[], frame: CanvasFrameBounds): boolean {
  return points.some(
    (point, index) => index > 0 && lineCrossesFrameInterior(points[index - 1]!, point, frame),
  );
}

function leavesSourceWithoutReturning(
  points: readonly CanvasPoint[],
  frame: CanvasFrameBounds,
): boolean {
  let hasLeftSource = !pointIsInsideFrame(points[0] ?? { x: 0, y: 0 }, frame);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    if (!hasLeftSource) {
      if (!pointIsInsideFrame(point, frame)) hasLeftSource = true;
      continue;
    }
    if (lineCrossesFrameInterior(previous, point, frame)) return false;
  }
  return true;
}

function crossProduct(origin: CanvasPoint, first: CanvasPoint, second: CanvasPoint): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
  );
}

function segmentsProperlyIntersect(
  firstStart: CanvasPoint,
  firstEnd: CanvasPoint,
  secondStart: CanvasPoint,
  secondEnd: CanvasPoint,
): boolean {
  const first = crossProduct(firstStart, firstEnd, secondStart);
  const second = crossProduct(firstStart, firstEnd, secondEnd);
  const third = crossProduct(secondStart, secondEnd, firstStart);
  const fourth = crossProduct(secondStart, secondEnd, firstEnd);
  return (
    Math.abs(first) > DIRECT_PATH_EPSILON &&
    Math.abs(second) > DIRECT_PATH_EPSILON &&
    Math.abs(third) > DIRECT_PATH_EPSILON &&
    Math.abs(fourth) > DIRECT_PATH_EPSILON &&
    first > 0 !== second > 0 &&
    third > 0 !== fourth > 0
  );
}

function polylineHasProperSelfIntersection(points: readonly CanvasPoint[]): boolean {
  for (let firstIndex = 1; firstIndex < points.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 2; secondIndex < points.length; secondIndex += 1) {
      if (
        segmentsProperlyIntersect(
          points[firstIndex - 1]!,
          points[firstIndex]!,
          points[secondIndex - 1]!,
          points[secondIndex]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

const CUBIC_FRAME_FLATNESS = 0.25;
const CUBIC_FRAME_MAX_SUBDIVISION_DEPTH = 20;

function expandedFrame(frame: CanvasFrameBounds, amount: number): CanvasFrameBounds {
  return {
    left: frame.left - amount,
    top: frame.top - amount,
    right: frame.right + amount,
    bottom: frame.bottom + amount,
    centerX: frame.centerX,
    centerY: frame.centerY,
  };
}

function cubicControlBounds(segment: CanvasCubicSegment): CanvasBounds {
  const points = [segment.start, segment.control1, segment.control2, segment.end];
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function boundsOverlapFrame(bounds: CanvasBounds, frame: CanvasFrameBounds): boolean {
  return (
    bounds.right >= frame.left &&
    bounds.left <= frame.right &&
    bounds.bottom >= frame.top &&
    bounds.top <= frame.bottom
  );
}

function pointToLineDistance(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < DIRECT_PATH_EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(deltaX * (start.y - point.y) - (start.x - point.x) * deltaY) / length;
}

function cubicFlatness(segment: CanvasCubicSegment): number {
  return Math.max(
    pointToLineDistance(segment.control1, segment.start, segment.end),
    pointToLineDistance(segment.control2, segment.start, segment.end),
  );
}

function midpoint(left: CanvasPoint, right: CanvasPoint): CanvasPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function splitCubic(segment: CanvasCubicSegment): [CanvasCubicSegment, CanvasCubicSegment] {
  const startControl = midpoint(segment.start, segment.control1);
  const controls = midpoint(segment.control1, segment.control2);
  const controlEnd = midpoint(segment.control2, segment.end);
  const leftMiddle = midpoint(startControl, controls);
  const rightMiddle = midpoint(controls, controlEnd);
  const join = midpoint(leftMiddle, rightMiddle);
  return [
    { start: segment.start, control1: startControl, control2: leftMiddle, end: join },
    { start: join, control1: rightMiddle, control2: controlEnd, end: segment.end },
  ];
}

/**
 * Conservative analytic curve-vs-frame test. A cubic stays inside its
 * control hull, so a non-overlapping hull proves it cannot hit the screen.
 * Potential hits are recursively de Casteljau-split until their departure
 * from the chord is sub-pixel; only then does a line-vs-expanded-frame test
 * decide it. This avoids the narrow corner crossings a coarse marquee sample
 * can skip while keeping that sample cheap for hit testing.
 */
function cubicEntersFrameInterior(
  segment: CanvasCubicSegment,
  frame: CanvasFrameBounds,
  depth = 0,
): boolean {
  if (!boundsOverlapFrame(cubicControlBounds(segment), frame)) return false;
  const flatness = cubicFlatness(segment);
  if (flatness <= CUBIC_FRAME_FLATNESS) {
    return lineCrossesFrameInterior(
      segment.start,
      segment.end,
      expandedFrame(frame, flatness + DIRECT_PATH_EPSILON),
    );
  }
  // A finite cap keeps malformed persisted geometry bounded. Returning a
  // collision here is intentionally conservative: route to the safe
  // backbone rather than risk drawing through a screen.
  if (depth >= CUBIC_FRAME_MAX_SUBDIVISION_DEPTH) return true;
  const [left, right] = splitCubic(segment);
  return (
    cubicEntersFrameInterior(left, frame, depth + 1) ||
    cubicEntersFrameInterior(right, frame, depth + 1)
  );
}

function curveEntersFrameInterior(geometry: CanvasEdgeGeometry, frame: CanvasFrameBounds): boolean {
  if (geometry.cubicSegments?.length) {
    return geometry.cubicSegments.some((segment) => cubicEntersFrameInterior(segment, frame));
  }
  return polylineEntersFrame(geometry.hitPoints, frame);
}

/** Reject a free curve whenever its sampled outline crosses itself or any
 * screen after it has intentionally exited its recorded source anchor. This
 * is deliberately conservative: a rejected candidate falls back to the
 * deterministic exterior backbone rather than appearing to clip a card. */
function cubicRouteIsSafe(
  geometry: CanvasEdgeGeometry,
  sourceId: string,
  targetId: string,
  frames: readonly { id: string; frame: CanvasFrameBounds }[],
  sourceDirection: EdgePortDirection,
  targetDirection: EdgePortDirection,
): boolean {
  if (polylineHasProperSelfIntersection(geometry.hitPoints)) return false;
  if (!cubicRouteKeepsPortProgress(geometry, sourceDirection, targetDirection)) return false;
  return frames.every(({ id, frame }) => {
    if (id === sourceId) return leavesSourceWithoutReturning(geometry.hitPoints, frame);
    if (id === targetId) return !curveEntersFrameInterior(geometry, frame);
    return !curveEntersFrameInterior(geometry, frame);
  });
}

/**
 * The extreme facing spline deliberately leaves the narrow source→target
 * axis to make room for its terminal arc. It cannot satisfy the usual
 * monotonic-port test, but it still must never cross itself or a screen.
 */
function cubicRouteAvoidsFrames(
  geometry: CanvasEdgeGeometry,
  sourceId: string,
  targetId: string,
  frames: readonly { id: string; frame: CanvasFrameBounds }[],
): boolean {
  if (polylineHasProperSelfIntersection(geometry.hitPoints)) return false;
  return frames.every(({ id, frame }) => {
    if (id === sourceId) return leavesSourceWithoutReturning(geometry.hitPoints, frame);
    if (id === targetId) return !curveEntersFrameInterior(geometry, frame);
    return !curveEntersFrameInterior(geometry, frame);
  });
}

/**
 * A center-anchor drag may reshape a curve, but it may not turn its progress
 * back through a selected port. Sampling this invariant alongside the frame
 * test makes arbitrary persisted offsets safely clamp instead of producing a
 * folded S-curve. Each relationship has a different meaningful monotonic
 * axis: facing pairs share the source axis, adjacent pairs must advance away
 * from both endpoint normals, and same-side exterior loops advance only along
 * their cross-axis separation.
 */
function cubicRouteKeepsPortProgress(
  geometry: CanvasEdgeGeometry,
  sourceDirection: EdgePortDirection,
  targetDirection: EdgePortDirection,
): boolean {
  const sourceVector = portDirectionVector(sourceDirection);
  const targetVector = portDirectionVector(targetDirection);
  const progresses = (axis: CanvasPoint, sign = 1) =>
    geometry.hitPoints.every(
      (point, index) =>
        index === 0 || sign * dot(point, axis) >= sign * dot(geometry.hitPoints[index - 1]!, axis),
    );

  if (targetDirection === oppositePortDirection(sourceDirection)) {
    return progresses(sourceVector);
  }
  if (dot(sourceVector, targetVector) === 0) {
    return progresses(sourceVector) && progresses({ x: -targetVector.x, y: -targetVector.y });
  }
  if (targetDirection === sourceDirection) {
    const crossAxis = leftNormal(sourceVector);
    const crossDistance = dot(subtract(geometry.endPoint, geometry.startPoint), crossAxis);
    return (
      Math.abs(crossDistance) > DIRECT_PATH_EPSILON &&
      progresses(crossAxis, crossDistance >= 0 ? 1 : -1)
    );
  }
  return true;
}

function straightEdge(start: CanvasPoint, end: CanvasPoint): CanvasEdgeGeometry {
  return {
    path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    labelPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    startPoint: start,
    endPoint: end,
    isEditableCurve: false,
    hitPoints: [start, end],
  };
}

function elbowEdge(points: CanvasPoint[]): CanvasEdgeGeometry {
  const path = roundedOrthogonalPath(points, 14);
  const start = points[0] ?? { x: 0, y: 0 };
  const end = points.at(-1) ?? start;
  return {
    path,
    labelPoint: pointAlongPolyline(points, 0.5),
    startPoint: start,
    endPoint: end,
    isEditableCurve: false,
    hitPoints: points,
  };
}

/** A selected Curve on an automatic fan stays inside the same collision-safe
 * backbone as Bent, but its larger cubic corners make the route visibly and
 * immediately distinct. Retaining the polyline hit points keeps marquee,
 * arrow tangent, and crossing checks deterministic. */
function cubicBackboneEdge(points: CanvasPoint[]): CanvasEdgeGeometry {
  const start = points[0] ?? { x: 0, y: 0 };
  const end = points.at(-1) ?? start;
  if (points.length === 2) {
    const control1 = {
      x: start.x + (end.x - start.x) / 3,
      y: start.y + (end.y - start.y) / 3,
    };
    const control2 = {
      x: start.x + ((end.x - start.x) * 2) / 3,
      y: start.y + ((end.y - start.y) * 2) / 3,
    };
    // This is a generated presentation backbone, not the free normal cubic
    // whose midpoint the person can author. It may happen to contain one C,
    // but must not surface a fake editable anchor.
    return { ...cubicEdge(start, end, control1, control2), isEditableCurve: false };
  }
  return {
    path: roundedOrthogonalCubicPath(points, 28),
    labelPoint: pointAlongPolyline(points, 0.5),
    startPoint: start,
    endPoint: end,
    isEditableCurve: false,
    hitPoints: points,
  };
}

function pointAlongPolyline(points: readonly CanvasPoint[], fraction: number): CanvasPoint {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return points[0]!;
  const target = total * fraction;
  let travelled = 0;
  for (const [index, length] of lengths.entries()) {
    if (travelled + length < target) {
      travelled += length;
      continue;
    }
    const start = points[index]!;
    const end = points[index + 1]!;
    const progress = (target - travelled) / Math.max(length, 0.001);
    return {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    };
  }
  return points.at(-1)!;
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

/** Cubic equivalent of the rounded elbow. Each corner uses the exact cubic
 * conversion of a quadratic corner, with a larger radius than Bent so a
 * selected Curve has a clear visual change without widening into siblings. */
function roundedOrthogonalCubicPath(points: readonly CanvasPoint[], radius: number): string {
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
    const control1 = {
      x: enter.x + ((corner.x - enter.x) * 2) / 3,
      y: enter.y + ((corner.y - enter.y) * 2) / 3,
    };
    const control2 = {
      x: exit.x + ((corner.x - exit.x) * 2) / 3,
      y: exit.y + ((corner.y - exit.y) * 2) / 3,
    };
    path += ` L ${enter.x} ${enter.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${exit.x} ${exit.y}`;
  }
  const end = points.at(-1)!;
  return `${path} L ${end.x} ${end.y}`;
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
    isEditableCurve: true,
    endTangentPoint: control2,
    cubicSegments: [{ start, control1, control2, end }],
    hitPoints: sampleCubic(start, control1, control2, end),
  };
}

function sampleCubic(
  start: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
  end: CanvasPoint,
): CanvasPoint[] {
  return Array.from({ length: CUBIC_HIT_POINT_COUNT }, (_, index) => {
    const t = index / (CUBIC_HIT_POINT_COUNT - 1);
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
  });
}

/**
 * Move the central curve anchor without sacrificing either port normal. This
 * is a C2-continuous subdivision of the base cubic: at the original midpoint
 * it exactly reproduces the single-C curve, while a moved midpoint bends the
 * interior only. The two outer controls remain on the source and target
 * normals, so neither end develops the diagonal/J-shaped departure that a
 * direct control-point offset would create.
 */
function cubicEdgeThroughMidpoint(
  start: CanvasPoint,
  end: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
  midpoint: CanvasPoint,
): CanvasEdgeGeometry {
  const firstControl1 = {
    x: (start.x + control1.x) / 2,
    y: (start.y + control1.y) / 2,
  };
  const secondControl2 = {
    x: (control2.x + end.x) / 2,
    y: (control2.y + end.y) / 2,
  };
  const joinTangent = {
    x: (secondControl2.x - firstControl1.x) / 4,
    y: (secondControl2.y - firstControl1.y) / 4,
  };
  const firstControl2 = {
    x: midpoint.x - joinTangent.x,
    y: midpoint.y - joinTangent.y,
  };
  const secondControl1 = {
    x: midpoint.x + joinTangent.x,
    y: midpoint.y + joinTangent.y,
  };
  const firstSamples = sampleCubic(start, firstControl1, firstControl2, midpoint);
  const secondSamples = sampleCubic(midpoint, secondControl1, secondControl2, end);
  return {
    path: `M ${start.x} ${start.y} C ${firstControl1.x} ${firstControl1.y}, ${firstControl2.x} ${firstControl2.y}, ${midpoint.x} ${midpoint.y} C ${secondControl1.x} ${secondControl1.y}, ${secondControl2.x} ${secondControl2.y}, ${end.x} ${end.y}`,
    labelPoint: midpoint,
    startPoint: start,
    endPoint: end,
    isEditableCurve: true,
    endTangentPoint: secondControl2,
    cubicSegments: [
      {
        start,
        control1: firstControl1,
        control2: firstControl2,
        end: midpoint,
      },
      {
        start: midpoint,
        control1: secondControl1,
        control2: secondControl2,
        end,
      },
    ],
    hitPoints: [...firstSamples, ...secondSamples.slice(1)],
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
