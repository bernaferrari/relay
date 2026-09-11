export type AlignmentBox = { x: number; y: number; width: number; height: number };
export type AlignmentGuide = { axis: "x" | "y"; value: number; from: number; to: number };

/** Snap like anchors, then display all aligned edges of the resulting preview. */
export function snapMapPreview(
  moving: AlignmentBox,
  neighbors: readonly AlignmentBox[],
  scale: number,
) {
  const tolerance = 6 / scale;
  const nearby = neighbors.filter((box) => {
    const gapX = Math.max(0, box.x - moving.x - moving.width, moving.x - box.x - box.width);
    const gapY = Math.max(0, box.y - moving.y - moving.height, moving.y - box.y - box.height);
    return Math.hypot(gapX, gapY) * scale <= 400;
  });
  const offset = { x: 0, y: 0 };
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    let best: number | undefined;
    for (const box of nearby)
      for (const [source, target] of anchorPairs) {
        const delta = box[axis] + box[size] * target - moving[axis] - moving[size] * source;
        if (
          Math.abs(delta) <= tolerance &&
          (best === undefined || Math.abs(delta) < Math.abs(best))
        )
          best = delta;
      }
    offset[axis] = best ?? 0;
  }
  const snapped = { ...moving, x: moving.x + offset.x, y: moving.y + offset.y };
  const guides = new Map<string, AlignmentGuide>();
  const epsilon = 0.01 / scale;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const other = axis === "x" ? "y" : "x";
    const otherSize = axis === "x" ? "height" : "width";
    for (const box of nearby) {
      const sameBounds =
        Math.abs(snapped[axis] - box[axis]) < epsilon &&
        Math.abs(snapped[size] - box[size]) < epsilon;
      for (const [source, target] of anchorPairs) {
        if (sameBounds && source === 0.5) continue;
        const value = box[axis] + box[size] * target;
        if (Math.abs(value - snapped[axis] - snapped[size] * source) > epsilon) continue;
        const key = `${axis}:${Math.round(value / epsilon)}`;
        const existing = guides.get(key);
        guides.set(key, {
          axis,
          value,
          from:
            Math.min(snapped[other], box[other], existing ? existing.from + 12 / scale : Infinity) -
            12 / scale,
          to:
            Math.max(
              snapped[other] + snapped[otherSize],
              box[other] + box[otherSize],
              existing ? existing.to - 12 / scale : -Infinity,
            ) +
            12 / scale,
        });
      }
    }
  }
  return { dx: offset.x, dy: offset.y, guides: [...guides.values()] };
}

// Edges align with edges; centers align with centers, never with an edge.
const anchorPairs = [
  [0, 0],
  [1, 1],
  [0.5, 0.5],
  [0, 1],
  [1, 0],
] as const;
