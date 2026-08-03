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

export function groupAtPoint(
  groups: readonly MapGroup[],
  positions: Readonly<Record<string, CanvasPoint>>,
  point: CanvasPoint,
  excludedScreenIds: ReadonlySet<string> = new Set(),
): MapGroup | undefined {
  return [...groups].reverse().find((group) => {
    const reduced = {
      ...group,
      screenIds: group.screenIds.filter((id) => !excludedScreenIds.has(id)),
    };
    const geometry = mapGroupGeometry(reduced, positions) ?? mapGroupGeometry(group, positions);
    return (
      geometry &&
      point.x >= geometry.left &&
      point.x <= geometry.right &&
      point.y >= geometry.top &&
      point.y <= geometry.bottom
    );
  });
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

/** Reconciles visual membership after a screen drag. Moving every member of a
 * Group preserves it; moving individual screens lets their center point leave
 * or enter another Group. */
export function groupsAfterScreenDrag(
  groups: readonly MapGroup[],
  draggedIds: readonly string[],
  previousPositions: Readonly<Record<string, CanvasPoint>>,
  currentPositions: Readonly<Record<string, CanvasPoint>>,
  at: number,
): MapGroup[] {
  const moved = new Set(draggedIds);
  const wholeGroups = new Set(
    groups
      .filter(
        (group) =>
          group.screenIds.length > 0 && group.screenIds.every((screenId) => moved.has(screenId)),
      )
      .map((group) => group.id),
  );
  const movableIds = draggedIds.filter((id) => {
    const owner = groupForScreen(groups, id);
    return !owner || !wholeGroups.has(owner.id);
  });
  if (!movableIds.length) return [...groups];

  const movable = new Set(movableIds);
  const next = groups.map((group) => ({
    ...group,
    screenIds: group.screenIds.filter((id) => !movable.has(id)),
  }));
  for (const id of movableIds) {
    const position = currentPositions[id];
    if (!position) continue;
    const target = groupAtPoint(
      groups,
      previousPositions,
      { x: position.x + SCREEN_CARD_WIDTH / 2, y: position.y + SCREEN_CARD_HEIGHT / 2 },
      movable,
    );
    if (!target) continue;
    const destination = next.find((group) => group.id === target.id);
    if (destination && !destination.screenIds.includes(id)) destination.screenIds.push(id);
  }
  return next
    .filter((group) => group.screenIds.length > 0)
    .map((group) => {
      const previous = groups.find((candidate) => candidate.id === group.id);
      return JSON.stringify(group.screenIds) === JSON.stringify(previous?.screenIds)
        ? group
        : { ...group, updatedAt: at };
    });
}
