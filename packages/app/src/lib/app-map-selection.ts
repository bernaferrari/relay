import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";

export type CanvasSelectionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export const APP_MAP_MARQUEE_THRESHOLD = 4;
export const APP_MAP_SELECTION_PADDING = 6;

export function canvasSelectionRect(start: CanvasPoint, end: CanvasPoint): CanvasSelectionRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function screenIdsInSelection(
  screenIds: readonly string[],
  positions: Readonly<Record<string, CanvasPoint>>,
  selection: CanvasSelectionRect,
): string[] {
  return screenIds.filter((id) => {
    const position = positions[id];
    if (!position) return false;
    return (
      position.x <= selection.right &&
      position.x + SCREEN_CARD_WIDTH >= selection.left &&
      position.y <= selection.bottom &&
      position.y + SCREEN_CARD_HEIGHT >= selection.top
    );
  });
}

function pointInRect(point: CanvasPoint, selection: CanvasSelectionRect): boolean {
  return (
    point.x >= selection.left &&
    point.x <= selection.right &&
    point.y >= selection.top &&
    point.y <= selection.bottom
  );
}

function orientation(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(start: CanvasPoint, end: CanvasPoint, point: CanvasPoint): boolean {
  const epsilon = 0.000_001;
  return (
    Math.abs(orientation(start, end, point)) <= epsilon &&
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  );
}

function segmentsIntersect(
  firstStart: CanvasPoint,
  firstEnd: CanvasPoint,
  secondStart: CanvasPoint,
  secondEnd: CanvasPoint,
): boolean {
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  if (firstA * firstB < 0 && secondA * secondB < 0) return true;
  return (
    pointOnSegment(firstStart, firstEnd, secondStart) ||
    pointOnSegment(firstStart, firstEnd, secondEnd) ||
    pointOnSegment(secondStart, secondEnd, firstStart) ||
    pointOnSegment(secondStart, secondEnd, firstEnd)
  );
}

export function connectionIdsInSelection(
  connections: readonly { id: string; hitPoints: readonly CanvasPoint[] }[],
  selection: CanvasSelectionRect,
): string[] {
  const corners = [
    { x: selection.left, y: selection.top },
    { x: selection.right, y: selection.top },
    { x: selection.right, y: selection.bottom },
    { x: selection.left, y: selection.bottom },
  ];
  const borders = corners.map((point, index) => [point, corners[(index + 1) % 4]!] as const);
  return connections.flatMap((connection) => {
    if (connection.hitPoints.some((point) => pointInRect(point, selection))) return [connection.id];
    const crosses = connection.hitPoints.slice(1).some((point, index) => {
      const previous = connection.hitPoints[index]!;
      return borders.some(([start, end]) => segmentsIntersect(previous, point, start, end));
    });
    return crosses ? [connection.id] : [];
  });
}

export function selectedScreensRect(
  screenIds: readonly string[],
  positions: Readonly<Record<string, CanvasPoint>>,
  padding = APP_MAP_SELECTION_PADDING,
): CanvasSelectionRect | null {
  const members = screenIds.flatMap((id) => {
    const position = positions[id];
    return position ? [position] : [];
  });
  if (!members.length) return null;
  const left = Math.min(...members.map((point) => point.x)) - padding;
  const top = Math.min(...members.map((point) => point.y)) - padding;
  const right = Math.max(...members.map((point) => point.x + SCREEN_CARD_WIDTH)) + padding;
  const bottom = Math.max(...members.map((point) => point.y + SCREEN_CARD_HEIGHT)) + padding;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function mergeSelectedScreenIds(
  baseIds: readonly string[],
  hitIds: readonly string[],
  additive: boolean,
): string[] {
  return additive ? [...new Set([...baseIds, ...hitIds])] : [...hitIds];
}

/** A property panel represents one object. Marquee selection may still select
 * many screens, but only an unambiguous single hit opens screen details. */
export function selectionDetailsScreenId(screenIds: readonly string[]): string | null {
  return screenIds.length === 1 ? screenIds[0]! : null;
}
