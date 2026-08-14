import type { ConnectorPortDirection } from "./app-map-connector-routing";
import type {
  CanvasBounds,
  CanvasEdgeGeometry,
  CanvasFrameBounds,
  CanvasPoint,
} from "./app-map-canvas-layout";

type EdgePortDirection = ConnectorPortDirection;
type CanvasCubicSegment = NonNullable<CanvasEdgeGeometry["cubicSegments"]>[number];

export const DIRECT_PATH_EPSILON = 0.01;
const CUBIC_HIT_POINT_COUNT = 33;

export function pointIsInsideFrame(point: CanvasPoint, frame: CanvasFrameBounds): boolean {
  return (
    point.x >= frame.left - DIRECT_PATH_EPSILON &&
    point.x <= frame.right + DIRECT_PATH_EPSILON &&
    point.y >= frame.top - DIRECT_PATH_EPSILON &&
    point.y <= frame.bottom + DIRECT_PATH_EPSILON
  );
}

export function oppositePortDirection(direction: EdgePortDirection): EdgePortDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

export function portDirectionVector(direction: EdgePortDirection): CanvasPoint {
  if (direction === "left") return { x: -1, y: 0 };
  if (direction === "right") return { x: 1, y: 0 };
  if (direction === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

export function dot(left: CanvasPoint, right: CanvasPoint): number {
  return left.x * right.x + left.y * right.y;
}

export function subtract(left: CanvasPoint, right: CanvasPoint): CanvasPoint {
  return { x: left.x - right.x, y: left.y - right.y };
}

export function leftNormal(direction: CanvasPoint): CanvasPoint {
  return { x: -direction.y, y: direction.x };
}

export function lineCrossesFrameInterior(
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

export function midpoint(left: CanvasPoint, right: CanvasPoint): CanvasPoint {
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
export function cubicRouteIsSafe(
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
export function cubicRouteAvoidsFrames(
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

export function straightEdge(start: CanvasPoint, end: CanvasPoint): CanvasEdgeGeometry {
  return {
    path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    labelPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    startPoint: start,
    endPoint: end,
    isEditableCurve: false,
    hitPoints: [start, end],
  };
}

export function elbowEdge(points: CanvasPoint[]): CanvasEdgeGeometry {
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
export function cubicBackboneEdge(points: CanvasPoint[]): CanvasEdgeGeometry {
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

export function pointAlongPolyline(points: readonly CanvasPoint[], fraction: number): CanvasPoint {
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

export function cubicEdge(
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

export function sampleCubic(
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
export function cubicEdgeThroughMidpoint(
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
