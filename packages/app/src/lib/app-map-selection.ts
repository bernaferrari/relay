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
