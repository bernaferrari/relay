/**
 * Screens saved at near-identical coordinates stack their names on top of each
 * other, so a map with two cards a few pixels apart shows one unreadable smear
 * instead of two names. Saved positions are the person's, not ours, so the
 * cards stay exactly where they were put and only the name is lifted onto a
 * free row — the way a Figma frame name never sits under another one.
 */

import {
  MAX_LABEL_COUNTER_SCALE,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  SCREEN_FRAME_TOP,
  SCREEN_LABEL_HEIGHT,
  screenLabelBounds,
} from "./app-map-screen-layout";

/** One card pitch: a name may overhang its own frame, never its neighbour. */
const LABEL_WIDTH = SCREEN_CARD_WIDTH;

/**
 * Taller than the name it moves, so the common case — two screens dropped a
 * few pixels apart — clears in a single step instead of climbing the stack.
 */
export const LABEL_ROW_PITCH = SCREEN_LABEL_HEIGHT + 8;

/** Beyond this, lifting names further hides them behind the cards above. */
const MAX_ROW = 3;

type LabelNode = { id: string; x: number; y: number };
type LabelBox = { left: number; top: number };

function labelBox(node: LabelNode, row: number): LabelBox {
  return { left: node.x, top: node.y - row * LABEL_ROW_PITCH };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.left - b.left) < LABEL_WIDTH - 8 && Math.abs(a.top - b.top) < SCREEN_LABEL_HEIGHT
  );
}

/**
 * Whether lifting a name onto this row would paint it inside a frame it does not
 * label. The lift is counter-scaled along with the name, so a row that looks
 * safely airborne at 100% is several rows higher once the map is fitted; the
 * band is therefore measured at the most zoomed-out reading.
 */
function entersAnotherFrame(node: LabelNode, row: number, nodes: readonly LabelNode[]): boolean {
  const band = screenLabelBounds(node, row * LABEL_ROW_PITCH * MAX_LABEL_COUNTER_SCALE);
  return nodes.some(
    (other) =>
      other.id !== node.id &&
      band.left < other.x + SCREEN_CARD_WIDTH &&
      other.x < band.right &&
      band.top < other.y + SCREEN_CARD_HEIGHT &&
      other.y + SCREEN_FRAME_TOP < band.bottom,
  );
}

/**
 * Row index per screen, where 0 is the name's usual place directly above the
 * frame and each step lifts it one row higher. Order is deterministic so the
 * same map always resolves the same way, on every machine and every reload.
 */
export function screenLabelRows(nodes: readonly LabelNode[]): Record<string, number> {
  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const placed: LabelBox[] = [];
  const rows: Record<string, number> = {};
  for (const node of ordered) {
    // Row 0 is the card's own reserved band, so it is always a candidate. Higher
    // rows are only offered when the lifted name stays out of every other frame:
    // an unreadable pair of names is a smaller problem than a name that reads as
    // the title of somebody else's screen.
    const candidates = [0];
    for (let row = 1; row <= MAX_ROW; row += 1) {
      if (!entersAnotherFrame(node, row, nodes)) candidates.push(row);
    }
    const free = (candidate: number) =>
      !placed.some((other) => overlaps(labelBox(node, candidate), other));
    const row = candidates.find(free) ?? candidates[candidates.length - 1]!;
    placed.push(labelBox(node, row));
    if (row > 0) rows[node.id] = row;
  }
  return rows;
}
