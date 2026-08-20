export function nextRovingIndex(
  key: string,
  current: number,
  count: number,
  orientation: "horizontal" | "vertical",
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  if (key === forward) return (current + 1 + count) % count;
  if (key === backward) return (current - 1 + count) % count;
  return null;
}

/** Move through a dense Combine grid without tabbing every cell. Home/End
 * stay on the current row so a 40-locale matrix does not dump focus. */
export function nextGridRovingIndex(
  key: string,
  current: number,
  columns: number,
  count: number,
): number | null {
  if (count <= 0 || columns <= 0) return null;
  if (key === "Home") return current - (current % columns);
  if (key === "End") return Math.min(count - 1, current - (current % columns) + columns - 1);
  const row = Math.floor(current / columns);
  const column = current % columns;
  if (key === "ArrowRight") return current + 1 < count ? current + 1 : current;
  if (key === "ArrowLeft") return current > 0 ? current - 1 : current;
  if (key === "ArrowDown") {
    const next = (row + 1) * columns + column;
    return next < count ? next : current;
  }
  if (key === "ArrowUp") return row > 0 ? (row - 1) * columns + column : current;
  return null;
}
