export type LayoutPoint = { x: number; y: number };

/** Treat saved/manual positions as anchors and pack other boxes around them. */
export function separateMapScreens(
  points: ReadonlyMap<string, LayoutPoint>,
  anchored: ReadonlySet<string>,
  width: number,
  height: number,
  gap = 32,
): Map<string, LayoutPoint> {
  const placed = new Map<string, LayoutPoint>();
  const ordered = [...points].sort(([a], [b]) => Number(anchored.has(b)) - Number(anchored.has(a)));
  for (const [id, original] of ordered) {
    const point = { ...original };
    let collision: LayoutPoint | undefined;
    do {
      collision = [...placed.values()].find(
        (other) =>
          point.x < other.x + width + gap &&
          point.x + width + gap > other.x &&
          point.y < other.y + height + gap &&
          point.y + height + gap > other.y,
      );
      if (collision) point.y = collision.y + height + gap;
    } while (collision);
    placed.set(id, point);
  }
  return new Map([...points.keys()].map((id) => [id, placed.get(id)!]));
}
