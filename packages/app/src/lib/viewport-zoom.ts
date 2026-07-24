export type CanvasViewport = { x: number; y: number; scale: number };
export type CanvasPoint = { x: number; y: number };

/**
 * Change a canvas scale without moving the world position under `anchor`.
 *
 * Canvas positions are viewport-relative, while the content transform is
 * `translate(x, y) scale(scale)`. Solving that transform before and after the
 * scale change gives the translation that keeps the cursor's world point still.
 */
export function zoomViewportAtPoint(
  viewport: CanvasViewport,
  nextScale: number,
  anchor: CanvasPoint,
): CanvasViewport {
  const worldX = (anchor.x - viewport.x) / viewport.scale;
  const worldY = (anchor.y - viewport.y) / viewport.scale;
  return {
    scale: nextScale,
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
  };
}
