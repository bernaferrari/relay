import type { MapPoint } from "./map-canvas-geometry";

/** Separate forward elbows, reserving the end of each lane for its label. */
export function forwardRoute(
  start: MapPoint,
  end: MapPoint,
  sourceRight: number,
  slot: number,
  count: number,
) {
  if (Math.abs(start.y - end.y) < 1) return [start, end];
  const left = Math.max(start.x + 20, sourceRight + 28);
  const right = Math.max(left, end.x - 128);
  const spacing = Math.min(12, (right - left) / Math.max(1, count - 1));
  // For downward routes the longest line stays nearest the source; upward
  // routes reverse that order so horizontal exits do not cross sibling trunks.
  const index = end.y < start.y ? slot : count - slot - 1;
  const lane = left + Math.max(0, index) * spacing;
  return [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end];
}
