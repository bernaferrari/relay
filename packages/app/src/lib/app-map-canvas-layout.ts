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
  const tangentPoint = previousDistinctPoint(geometry.hitPoints, end);
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
const CONNECTOR_TARGET_GAP_SCREEN_PIXELS = 8;
/** A nearly facing automatic pair should look like the single intentional
 * gesture it is, not a two-corner dogleg. Keep this in world space so the
 * decision does not flicker while the person zooms. */
const DIRECT_FACING_ALIGNMENT = 20;
const DIRECT_PATH_EPSILON = 0.01;
const DIRECT_FACING_MIN_FORWARD_DISTANCE = 16;
const MIN_CUBIC_PULL = 8;
const MAX_CUBIC_PULL_FRACTION = 0.42;
/** A curve needs a visibly straight arrival, not only an infinitesimal Bézier
 * tangent at the arrowhead. This stays world-space so it reads consistently
 * as the canvas zooms. */
const CURVE_TERMINAL_LEAD_IN = 32;
/** Ignore sub-pixel-to-a-few-pixel pointer noise on a computed source fan.
 * This is presentation behavior, never a migration or persistence rewrite. */
const AUTOMATIC_FAN_CURVE_JITTER_RADIUS = 8;

/**
 * Resolve the FigJam-style terminal clearance in world coordinates. Keeping
 * its rendered size constant means the deliberate air gap remains visible at
 * both the readable zoom floor and close inspection zoom, rather than
 * disappearing when a dense map is zoomed out.
 */
export function connectorTargetGapForViewport(viewportScale?: number): number {
  if (viewportScale === undefined || !Number.isFinite(viewportScale) || viewportScale <= 0) {
    return CONNECTOR_TARGET_GAP;
  }
  return CONNECTOR_TARGET_GAP_SCREEN_PIXELS / viewportScale;
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
  const elbowPoints = () =>
    smartElbowPoints({
      start,
      end,
      sourceDirection: direction,
      targetDirection,
      sourceFrame: fromFrame,
      targetFrame: toFrame,
      obstacleFrames: nodes.map((node) =>
        screenFrameBounds(positionFor(node), geometryFor?.(node) ?? screenCardGeometry()),
      ),
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
    directFacingPathIsClear(start, end, direction, targetDirection, from.id, to.id, nodes, positionFor, geometryFor)
  ) {
    return straightEdge(start, end);
  }
  if (route === "elbow") return elbowEdge(elbowPoints());

  const offset = edge.presentation?.controlOffset;
  const sourceVector = portDirectionVector(direction);
  const forwardDistance = cubicForwardDistance(start, end, direction, targetDirection);
  // A curve still needs a viable opposing exit/entry pair. Same-side and
  // near-zero spans would fold a free cubic back on itself, so retain the
  // obstacle-safe backbone for only those impossible geometries.
  if (forwardDistance === undefined || forwardDistance < DIRECT_FACING_MIN_FORWARD_DISTANCE) {
    return elbowEdge(elbowPoints());
  }
  // Curve is an explicit selected route. On an automatic fan, a default or
  // tiny pointer-jitter offset becomes a visibly smoother compound cubic
  // along the reserved no-crossing backbone—not a Bent/Q route that appears
  // unchanged until someone drags an anchor. A meaningful anchor movement
  // remains a free authored cubic below.
  if (edge.automaticSourceLane && !hasMeaningfulAutomaticFanCurveOffset(offset)) {
    return cubicBackboneEdge(elbowPoints());
  }
  // Reserve the final part of a free curve for a real straight run into the
  // selected target port. The cubic ends at `leadStart` with a matching
  // target-direction derivative, then the line continues G1-smoothly into
  // the arrow tip. Very short viable spans simply reserve what they can.
  const terminalLead = Math.min(
    CURVE_TERMINAL_LEAD_IN,
    Math.max(0, forwardDistance - DIRECT_FACING_MIN_FORWARD_DISTANCE),
  );
  const leadStart = {
    x: end.x + targetVector.x * terminalLead,
    y: end.y + targetVector.y * terminalLead,
  };
  const curveForwardDistance = forwardDistance - terminalLead;
  const naturalPull = Math.hypot(leadStart.x - start.x, leadStart.y - start.y) * 0.35;
  const pull = Math.min(
    Math.max(MIN_CUBIC_PULL, naturalPull),
    curveForwardDistance * MAX_CUBIC_PULL_FRACTION,
  );
  const baseControl1 = {
    x: start.x + sourceVector.x * pull,
    y: start.y + sourceVector.y * pull,
  };
  const baseControl2 = {
    x: leadStart.x + targetVector.x * pull,
    y: leadStart.y + targetVector.y * pull,
  };
  if (!offset) return cubicEdgeWithTerminalLeadIn(start, leadStart, end, baseControl1, baseControl2);
  // Moving both controls by 4/3 of the requested offset moves the cubic's
  // midpoint by exactly that offset. Clamp only the forward component so the
  // two controls retain their source→target order; perpendicular shaping is
  // still completely free and cannot create a loop along the connection.
  const requested = { x: (offset.x * 4) / 3, y: (offset.y * 4) / 3 };
  const forwardAdjustment = requested.x * sourceVector.x + requested.y * sourceVector.y;
  const safeForwardAdjustment = Math.min(Math.max(forwardAdjustment, -pull), pull);
  const perpendicularAdjustment = {
    x: requested.x - sourceVector.x * forwardAdjustment,
    y: requested.y - sourceVector.y * forwardAdjustment,
  };
  const adjustment = {
    x: perpendicularAdjustment.x + sourceVector.x * safeForwardAdjustment,
    y: perpendicularAdjustment.y + sourceVector.y * safeForwardAdjustment,
  };
  return cubicEdgeWithTerminalLeadIn(
    start,
    leadStart,
    end,
    { x: baseControl1.x + adjustment.x, y: baseControl1.y + adjustment.y },
    { x: baseControl2.x + adjustment.x, y: baseControl2.y + adjustment.y },
  );
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
 * arranged to the right is a right→left connection even when it sits lower on
 * the canvas: changing it to bottom→top makes the endpoint look unrelated to
 * the diagram's reading direction. Vertical ports take over only when the
 * frames overlap horizontally. Explicit endpoint ports bypass this chooser.
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
          Math.abs(targetPoint.x - sourcePoint.x) + Math.abs(targetPoint.y - sourcePoint.y),
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
  return (
    offset !== undefined &&
    Math.hypot(offset.x, offset.y) > AUTOMATIC_FAN_CURVE_JITTER_RADIUS
  );
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

function straightEdge(start: CanvasPoint, end: CanvasPoint): CanvasEdgeGeometry {
  return {
    path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    labelPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    startPoint: start,
    endPoint: end,
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
    return cubicEdge(start, end, control1, control2);
  }
  return {
    path: roundedOrthogonalCubicPath(points, 28),
    labelPoint: pointAlongPolyline(points, 0.5),
    startPoint: start,
    endPoint: end,
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

/** A free cubic with a perceptible final run into its selected port. The
 * final line is intentionally part of hit geometry so arrow orientation,
 * marquee selection, and the visible terminal always agree. */
function cubicEdgeWithTerminalLeadIn(
  start: CanvasPoint,
  leadStart: CanvasPoint,
  end: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
): CanvasEdgeGeometry {
  if (Math.hypot(end.x - leadStart.x, end.y - leadStart.y) < DIRECT_PATH_EPSILON) {
    return cubicEdge(start, end, control1, control2);
  }
  const cubicPoints = Array.from({ length: 17 }, (_, index) => {
    const t = index / 16;
    const inverse = 1 - t;
    return {
      x:
        inverse ** 3 * start.x +
        3 * inverse ** 2 * t * control1.x +
        3 * inverse * t ** 2 * control2.x +
        t ** 3 * leadStart.x,
      y:
        inverse ** 3 * start.y +
        3 * inverse ** 2 * t * control1.y +
        3 * inverse * t ** 2 * control2.y +
        t ** 3 * leadStart.y,
    };
  });
  return {
    path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${leadStart.x} ${leadStart.y} L ${end.x} ${end.y}`,
    // Keep the curve's existing editable midpoint convention. Moving both
    // handles by 4/3 of an offset therefore still moves this point exactly
    // by the requested amount, independent of terminal clearance.
    labelPoint: {
      x: (start.x + 3 * control1.x + 3 * control2.x + leadStart.x) / 8,
      y: (start.y + 3 * control1.y + 3 * control2.y + leadStart.y) / 8,
    },
    startPoint: start,
    endPoint: end,
    hitPoints: [...cubicPoints, end],
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
