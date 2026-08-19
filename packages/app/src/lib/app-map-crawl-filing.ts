import { isCrawlFilingSlot } from "@relay/protocol";
import type { CanvasPoint } from "./app-map-canvas-layout";

/** Below this a map has no arrangement to preserve or to read as a journey. */
const MIN_FILED_SCREENS = 2;

/**
 * Whether a map's saved geometry is somebody's arrangement or only the order an
 * accepted crawl filed its screens in.
 *
 * A crawl accepts screens into a fixed four-column lattice, one slot per
 * observed state. That is the shape of the accept path, not of the app: it reads
 * as a contact sheet of phones rather than the paths between them, which is the
 * one thing the canvas exists to show. Recognising it lets the canvas offer the
 * tidy journey it can already compute for the same graph, instead of a map
 * nobody has ever arranged looking exactly like one somebody has.
 *
 * One screen dragged anywhere is an arrangement, and the whole map is then left
 * alone — including the rest of the crawl around it. Rearranging the frames
 * someone did not touch would move their work out from under them; Tidy map
 * stays the way to ask for it.
 */
export function isUnarrangedCrawlFiling(positions: Readonly<Record<string, CanvasPoint>>): boolean {
  const points = Object.values(positions);
  return points.length >= MIN_FILED_SCREENS && points.every(isCrawlFilingSlot);
}
