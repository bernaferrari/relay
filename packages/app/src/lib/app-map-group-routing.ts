import type { CanvasPoint } from "./app-map-canvas-layout";

export type GroupRouteBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type GroupBundleGeometry = {
  axis: "horizontal" | "vertical";
  sourcePort: CanvasPoint;
  targetPort: CanvasPoint;
  trunkPath: string;
};

/**
 * Route compound-graph edges through one stable port on each group. Individual
 * screen connections fan into this shared trunk, turning N long wires into one
 * readable relationship between two regions.
 */
export function groupBundleGeometry(
  source: GroupRouteBounds,
  target: GroupRouteBounds,
): GroupBundleGeometry {
  const sourceCenter = rectCenter(source);
  const targetCenter = rectCenter(target);
  const horizontal =
    Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);

  if (horizontal) {
    const forward = targetCenter.x >= sourceCenter.x;
    const sourcePort = {
      x: forward ? source.right : source.left,
      y: clamp(targetCenter.y, source.top + 48, source.bottom - 20),
    };
    const targetPort = {
      x: forward ? target.left : target.right,
      y: clamp(sourceCenter.y, target.top + 48, target.bottom - 20),
    };
    const channel = (sourcePort.x + targetPort.x) / 2;
    return {
      axis: "horizontal",
      sourcePort,
      targetPort,
      trunkPath: roundedOrthogonalPath([
        sourcePort,
        { x: channel, y: sourcePort.y },
        { x: channel, y: targetPort.y },
        targetPort,
      ]),
    };
  }

  const forward = targetCenter.y >= sourceCenter.y;
  const sourcePort = {
    x: clamp(targetCenter.x, source.left + 20, source.right - 20),
    y: forward ? source.bottom : source.top,
  };
  const targetPort = {
    x: clamp(sourceCenter.x, target.left + 20, target.right - 20),
    y: forward ? target.top : target.bottom,
  };
  const channel = (sourcePort.y + targetPort.y) / 2;
  return {
    axis: "vertical",
    sourcePort,
    targetPort,
    trunkPath: roundedOrthogonalPath([
      sourcePort,
      { x: sourcePort.x, y: channel },
      { x: targetPort.x, y: channel },
      targetPort,
    ]),
  };
}

export function groupBundleSpokePath(
  point: CanvasPoint,
  port: CanvasPoint,
  axis: GroupBundleGeometry["axis"],
): string {
  return axis === "horizontal"
    ? roundedOrthogonalPath([point, { x: port.x, y: point.y }, port])
    : roundedOrthogonalPath([point, { x: point.x, y: port.y }, port]);
}

function rectCenter(rect: GroupRouteBounds): CanvasPoint {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundedOrthogonalPath(input: readonly CanvasPoint[]): string {
  const points = input.filter(
    (point, index) =>
      index === 0 || point.x !== input[index - 1]!.x || point.y !== input[index - 1]!.y,
  );
  const start = points[0];
  if (!start) return "";
  let path = `M ${start.x} ${start.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[index + 1];
    if (!next) {
      path += ` L ${point.x} ${point.y}`;
      continue;
    }
    const previous = points[index - 1]!;
    const radius = Math.min(
      12,
      Math.hypot(point.x - previous.x, point.y - previous.y) / 2,
      Math.hypot(next.x - point.x, next.y - point.y) / 2,
    );
    const before = moveToward(point, previous, radius);
    const after = moveToward(point, next, radius);
    path += ` L ${before.x} ${before.y} Q ${point.x} ${point.y}, ${after.x} ${after.y}`;
  }
  return path;
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
