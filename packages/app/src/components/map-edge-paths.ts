import type { ProductMapPath } from "@relay/product/map-exploration";
import type { MapPoint } from "./map-canvas-geometry";

// Axis-aligned segments with bounded corner radii; straight continuations
// remain straight instead of acquiring unnecessary bezier curvature.
export function roundedConnector(points: readonly MapPoint[], radius = 12): string {
  const clean = points.filter(
    (point, index) =>
      !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
  if (!clean.length) return "";
  let d = `M ${clean[0]!.x} ${clean[0]!.y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const previous = clean[i - 1]!,
      current = clean[i]!,
      next = clean[i + 1]!;
    const before = Math.hypot(current.x - previous.x, current.y - previous.y);
    const after = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, before / 2, after / 2);
    const entry = {
      x: current.x + ((previous.x - current.x) * r) / before,
      y: current.y + ((previous.y - current.y) * r) / before,
    };
    const exit = {
      x: current.x + ((next.x - current.x) * r) / after,
      y: current.y + ((next.y - current.y) * r) / after,
    };
    if (
      (current.x - previous.x) * (next.y - current.y) ===
      (current.y - previous.y) * (next.x - current.x)
    )
      d += ` L ${current.x} ${current.y}`;
    else d += ` L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`;
  }
  if (clean.length > 1) d += ` L ${clean.at(-1)!.x} ${clean.at(-1)!.y}`;
  return d;
}

type PreviewBox = { x: number; y: number; width: number; height: number };
/** Returns use bottom ports, leaving the center lane for forward navigation. */
export function returnConnector(
  source: PreviewBox,
  target: PreviewBox,
  slot = 0,
  count = 1,
  anchor?: MapPoint,
) {
  const gap = 14;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;
  const end = {
    x: target.x + target.width * (0.2 + (0.3 * (slot + 1)) / (Math.max(1, count) + 1)),
    y: targetBottom + gap,
  };
  if (Math.abs(source.y - target.y) < 40) {
    const start = anchor ?? { x: source.x + source.width * 0.65, y: sourceBottom + gap };
    const y = Math.max(sourceBottom, targetBottom) + 44 + slot * 28;
    return {
      points: [start, { x: start.x, y }, { x: end.x, y }, end],
      label: { x: (start.x + end.x) / 2, y: y - 12 },
    };
  }
  // Unequal rows take the inter-column corridor directly, without first
  // climbing above both previews and doubling back down the same corridor.
  const leftward = source.x > target.x;
  const start = anchor ?? {
    x: leftward ? source.x - gap : source.x + source.width + gap,
    y: source.y + source.height * 0.78,
  };
  const corridorX = leftward
    ? (source.x + target.x + target.width) / 2 + 24 + Math.min(slot, 3) * 12
    : (source.x + source.width + target.x) / 2 - 24 - Math.min(slot, 3) * 12;
  // An upper screen returns to a visible side port, not underneath the
  // destination's discovery chip where the arrowhead would be obscured.
  if (source.y < target.y) {
    const sideEnd = {
      x: leftward ? target.x + target.width + gap : target.x - gap,
      y: target.y + target.height * (0.7 + (0.2 * (slot + 1)) / (Math.max(1, count) + 1)),
    };
    return {
      points: [start, { x: corridorX, y: start.y }, { x: corridorX, y: sideEnd.y }, sideEnd],
      label: { x: corridorX, y: (start.y + sideEnd.y) / 2 },
    };
  }
  const y = targetBottom + 44 + (slot / Math.max(1, count - 1)) * 48;
  return {
    points: [start, { x: corridorX, y: start.y }, { x: corridorX, y }, { x: end.x, y }, end],
    label: { x: corridorX, y: Math.abs(start.y - y) > 100 ? (start.y + y) / 2 : start.y - 12 },
  };
}

export function isRoutineReturn(path: Pick<ProductMapPath, "label" | "toScreenId">): boolean {
  return Boolean(
    path.toScreenId && /^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label),
  );
}

/** A single shallow bend distinguishes a revealed return from forward elbows. */
export function quadraticReturn(points: readonly MapPoint[]): string {
  const start = points[0],
    end = points.at(-1);
  if (!start || !end) return "";
  const aligned = Math.abs(start.y - end.y) < 40;
  const control = aligned
    ? { x: (start.x + end.x) / 2, y: Math.max(start.y, end.y) + 72 }
    : { x: end.x, y: start.y };
  return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
}

/** A compact loop outside the preview, above its normal center connection port. */
export function selfLoopConnector(
  box: { x: number; y: number; width: number; height: number },
  slot = 0,
  anchor?: MapPoint,
): MapPoint[] {
  const edge = box.x + box.width + 14;
  const start = anchor ?? { x: edge, y: box.y + box.height * 0.36 };
  const end = { x: edge, y: box.y + box.height * 0.08 };
  const lane = edge + 48 + slot * 24;
  return [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end];
}

/** Reciprocal tab and new-chat actions also return to an earlier screen in this layout. */
export function isMapReturn(
  path: Pick<ProductMapPath, "label" | "fromScreenId" | "toScreenId">,
  positions: ReadonlyMap<string, MapPoint>,
  horizontal = false,
): boolean {
  if (isRoutineReturn(path)) return true;
  const from = positions.get(path.fromScreenId),
    to = positions.get(path.toScreenId ?? "");
  return Boolean(from && to && (horizontal ? to.y < from.y : to.x < from.x));
}
