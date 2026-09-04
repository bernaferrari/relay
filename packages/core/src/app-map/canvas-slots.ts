import { crawlFilingSlot, type AppMap } from "@relay/protocol";

/**
 * Where a newly observed screen is filed on the canvas.
 *
 * A screen's footprint is not only its card. The frame's name sits in a band
 * above the card and grows upward as the camera zooms out, the way a Figma
 * frame name does, so a slot has to reserve both. These numbers mirror the
 * canvas card in `packages/app-v2/src/components/infinite-map-canvas.tsx`; the pitch is
 * deliberately looser than the card so an accepted crawl reads as a grid before
 * anyone tidies it.
 */
const CARD_WIDTH = 240;
const CARD_HEIGHT = 230;
const LABEL_BAND = 34;

export type CanvasSlot = { x: number; y: number };

function reservedArea(slot: CanvasSlot) {
  return {
    left: slot.x,
    right: slot.x + CARD_WIDTH,
    top: slot.y - LABEL_BAND,
    bottom: slot.y + CARD_HEIGHT,
  };
}

function reservationsCollide(left: CanvasSlot, right: CanvasSlot): boolean {
  const first = reservedArea(left);
  const second = reservedArea(right);
  return (
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom
  );
}

/**
 * Hands out the next free lattice slot for a batch of new screens.
 *
 * Both accept paths used to derive a slot from an index they owned alone — the
 * position within one proposal, or the map's screen count — so a second crawl
 * filed its screens directly on top of the first crawl's and two frames shared
 * one card. Occupancy is measured geometrically rather than by slot index so a
 * screen someone has since dragged still keeps its space.
 */
export function canvasSlotAllocator(map: Pick<AppMap, "screens">): () => CanvasSlot {
  const taken: CanvasSlot[] = Object.values(map.screens).flatMap((screen) =>
    screen.position ? [{ x: screen.position.x, y: screen.position.y }] : [],
  );
  let index = 0;
  return () => {
    // A reserved area spans less than two columns and less than two rows, so a
    // single screen can block at most four lattice slots. With finitely many
    // screens already on the map the walk always reaches a free slot.
    for (;;) {
      const slot = crawlFilingSlot(index);
      index += 1;
      if (taken.some((other) => reservationsCollide(slot, other))) continue;
      taken.push(slot);
      return slot;
    }
  };
}
