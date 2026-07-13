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
