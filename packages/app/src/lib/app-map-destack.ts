import type { CanvasPoint } from "./app-map-canvas-layout";
import {
  CARD_PITCH_X,
  CARD_PITCH_Y,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  SCREEN_LABEL_BAND,
} from "./app-map-screen-layout";

/** Sub-pixel drift is the same point; a nudged card is somebody's arrangement. */
const COINCIDENT_EPSILON = 1;
/** Past this the stack is not a stale duplicate, it is a map nobody laid out. */
const MAX_DESTACK_RINGS = 6;

type SlotOffset = { dx: number; dy: number };

/**
 * Two cards at the same point are never an arrangement somebody made: one screen
 * is completely hidden behind the other, unclickable, its name stacked on top of
 * its neighbour's. Maps crawled before the slot allocator learned to reserve
 * space carry pairs like this in their saved positions, so the canvas resolves
 * them when it reads them rather than waiting for a migration or for somebody to
 * notice and press Tidy.
 *
 * This is a repair, not a re-layout. Only exactly-coincident screens move, only
 * the ones after the first, and only as far as the first slot that is clear — a
 * deliberate arrangement of merely-close cards is left where its author put it.
 */
export function resolveCoincidentPositions(
  positions: Readonly<Record<string, CanvasPoint>>,
): Readonly<Record<string, CanvasPoint>> {
  const entries = Object.entries(positions).sort(
    ([leftId, left], [rightId, right]) =>
      left.y - right.y || left.x - right.x || leftId.localeCompare(rightId),
  );
  const stacked = entries.some(([id, point]) =>
    entries.some(([otherId, other]) => otherId !== id && samePoint(point, other)),
  );
  if (!stacked) return positions;

  const resolved: Record<string, CanvasPoint> = {};
  const booked: CanvasPoint[] = [];
  const movers: (readonly [string, CanvasPoint])[] = [];
  for (const [id, point] of entries) {
    if (booked.some((other) => samePoint(point, other))) movers.push([id, point] as const);
    else {
      resolved[id] = point;
      booked.push(point);
    }
  }
  // Every screen that keeps its spot is booked before anything moves, so a freed
  // card cannot land on a screen this pass had not reached yet.
  for (const [id, point] of movers) {
    const offset = destackOffsets().find(offsetIsClear(point, booked));
    const spot = offset ? offsetPoint(point, offset) : point;
    resolved[id] = spot;
    booked.push(spot);
  }
  return resolved;
}

/**
 * The geometry a canvas edit should build on: every frame where the canvas has
 * been drawing it, plus whatever this edit moves.
 *
 * `shown` is the resolved geometry of every live screen — the saved document
 * with the readings the canvas applies to it, which is what the person was
 * looking at when they reached for a card.
 *
 * The first edit is where the reading becomes the document. Doing it here rather
 * than on load means the canvas never rewrites a map nobody touched, and never
 * leaves the rest of the map to snap back the moment one card moves: neither a
 * freed card returning to the point it was hidden at, nor a whole crawl
 * collapsing back to its filing lattice because one screen left it.
 */
export function positionsAfterCanvasEdit(
  shown: Readonly<Record<string, CanvasPoint>>,
  moved: Readonly<Record<string, CanvasPoint>>,
): Record<string, CanvasPoint> {
  return { ...resolveCoincidentPositions(shown), ...moved };
}

function samePoint(left: CanvasPoint, right: CanvasPoint): boolean {
  return (
    Math.abs(left.x - right.x) < COINCIDENT_EPSILON &&
    Math.abs(left.y - right.y) < COINCIDENT_EPSILON
  );
}

function offsetPoint(point: CanvasPoint, offset: SlotOffset): CanvasPoint {
  return { x: point.x + offset.dx * CARD_PITCH_X, y: point.y + offset.dy * CARD_PITCH_Y };
}

/**
 * A screen's footprint is its card plus the name band above it, so a freed card
 * has to clear both. Landing where only the cards miss each other traded a
 * hidden screen for a name painted across somebody else's frame — the same
 * defect, one step to the side.
 */
function offsetIsClear(point: CanvasPoint, booked: readonly CanvasPoint[]) {
  return (offset: SlotOffset) => {
    const candidate = offsetPoint(point, offset);
    return booked.every(
      (other) =>
        Math.abs(candidate.x - other.x) > SCREEN_CARD_WIDTH - COINCIDENT_EPSILON ||
        Math.abs(candidate.y - other.y) >
          SCREEN_CARD_HEIGHT + SCREEN_LABEL_BAND - COINCIDENT_EPSILON,
    );
  };
}

/**
 * Whole-slot steps out from the stack, nearest first, and down before up so a
 * freed screen lands where a top-down map is still growing. The fixed order
 * keeps the same map resolving the same way on every machine and every reload.
 */
function destackOffsets(): SlotOffset[] {
  const offsets: SlotOffset[] = [];
  for (let ring = 1; ring <= MAX_DESTACK_RINGS; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) offsets.push({ dx, dy });
      }
    }
  }
  return offsets.sort(
    (left, right) =>
      Math.abs(left.dx) + Math.abs(left.dy) - (Math.abs(right.dx) + Math.abs(right.dy)) ||
      right.dy - left.dy ||
      right.dx - left.dx,
  );
}
