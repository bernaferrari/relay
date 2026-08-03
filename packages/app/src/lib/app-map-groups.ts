import type { MapGroup } from "@relay/protocol";
import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH, type CanvasPoint } from "./app-map-canvas-layout";

export const MAP_GROUP_PADDING_X = 28;
export const MAP_GROUP_PADDING_TOP = 52;
export const MAP_GROUP_PADDING_BOTTOM = 28;

export type MapGroupGeometry = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Groups auto-wrap their current members. This keeps organization effortless:
 * there is no second box to resize and no hidden execution layout. */
export function mapGroupGeometry(
  group: Pick<MapGroup, "id" | "screenIds">,
  positions: Readonly<Record<string, CanvasPoint>>,
): MapGroupGeometry | null {
  const members = group.screenIds.flatMap((id) => {
    const position = positions[id];
    return position ? [position] : [];
  });
  if (!members.length) return null;
  const left = Math.min(...members.map((point) => point.x)) - MAP_GROUP_PADDING_X;
  const top = Math.min(...members.map((point) => point.y)) - MAP_GROUP_PADDING_TOP;
  const right =
    Math.max(...members.map((point) => point.x + SCREEN_CARD_WIDTH)) + MAP_GROUP_PADDING_X;
  const bottom =
    Math.max(...members.map((point) => point.y + SCREEN_CARD_HEIGHT)) + MAP_GROUP_PADDING_BOTTOM;
  return { id: group.id, left, top, right, bottom, width: right - left, height: bottom - top };
}

export function groupForScreen(
  groups: readonly MapGroup[],
  screenId: string,
): MapGroup | undefined {
  return groups.find((group) => group.screenIds.includes(screenId));
}

export function nextGroupName(groups: readonly MapGroup[]): string {
  const names = new Set(groups.map((group) => group.name));
  if (!names.has("Group")) return "Group";
  let index = 2;
  while (names.has(`Group ${index}`)) index += 1;
  return `Group ${index}`;
}
