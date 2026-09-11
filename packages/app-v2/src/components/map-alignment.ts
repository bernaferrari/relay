export type AlignmentBox = { x: number; y: number; width: number; height: number };
export type AlignmentGuide = { axis: "x" | "y"; value: number; from: number; to: number };

/** Compare visible preview bounds; tolerance and neighborhood are screen pixels. */
export function snapMapPreview(
  moving: AlignmentBox,
  neighbors: readonly AlignmentBox[],
  scale: number,
) {
  const tolerance = 6 / scale;
  const guides: AlignmentGuide[] = [];
  let dx = 0,
    dy = 0;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const other = axis === "x" ? "y" : "x";
    const otherSize = axis === "x" ? "height" : "width";
    let best: { delta: number; value: number; box: AlignmentBox } | undefined;
    for (const box of neighbors) {
      const gapX = Math.max(0, box.x - moving.x - moving.width, moving.x - box.x - box.width);
      const gapY = Math.max(0, box.y - moving.y - moving.height, moving.y - box.y - box.height);
      if (Math.hypot(gapX, gapY) * scale > 400) continue;
      for (const fraction of [0, 0.5, 1])
        for (const targetFraction of [0, 0.5, 1]) {
          const value = box[axis] + box[size] * targetFraction;
          const delta = value - moving[axis] - moving[size] * fraction;
          if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta)))
            best = { delta, value, box };
        }
    }
    if (best) {
      if (axis === "x") dx = best.delta;
      else dy = best.delta;
      guides.push({
        axis,
        value: best.value,
        from: Math.min(moving[other], best.box[other]) - 12 / scale,
        to:
          Math.max(moving[other] + moving[otherSize], best.box[other] + best.box[otherSize]) +
          12 / scale,
      });
    }
  }
  return { dx, dy, guides };
}
