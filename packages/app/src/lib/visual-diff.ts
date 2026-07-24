export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type VisualDifference = {
  changedPixels: number;
  totalPixels: number;
  ratio: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
};

/**
 * A deliberately simple, deterministic image comparison.
 *
 * The review UI downsamples frames before calling this, which avoids making
 * anti-aliasing or video compression noise look like a product regression.
 */
export function diffRgba(
  baseline: RgbaImage,
  current: RgbaImage,
  threshold = 42,
): VisualDifference {
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      changedPixels: Math.max(baseline.width * baseline.height, current.width * current.height),
      totalPixels: Math.max(baseline.width * baseline.height, current.width * current.height),
      ratio: 1,
      bounds: { x: 0, y: 0, width: current.width, height: current.height },
    };
  }
  let changedPixels = 0;
  let minX = baseline.width;
  let minY = baseline.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < baseline.height; y += 1) {
    for (let x = 0; x < baseline.width; x += 1) {
      const offset = (y * baseline.width + x) * 4;
      const delta =
        Math.abs(baseline.data[offset]! - current.data[offset]!) +
        Math.abs(baseline.data[offset + 1]! - current.data[offset + 1]!) +
        Math.abs(baseline.data[offset + 2]! - current.data[offset + 2]!);
      if (delta < threshold) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const totalPixels = baseline.width * baseline.height;
  return {
    changedPixels,
    totalPixels,
    ratio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
    bounds: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}
