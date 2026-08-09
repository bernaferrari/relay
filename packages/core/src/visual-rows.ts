/**
 * When the accessibility tree is missing, a screenshot still has rows.
 * These points prefer the leading label (not the trailing toggle).
 */
import { PNG } from "pngjs";

export type ProposedVisualRow = {
  x: number;
  y: number;
  top: number;
  bottom: number;
  height: number;
};

function lumaAt(image: PNG, x: number, y: number): number {
  const px = Math.max(0, Math.min(image.width - 1, x));
  const py = Math.max(0, Math.min(image.height - 1, y));
  const offset = (py * image.width + px) * 4;
  return (
    0.2126 * image.data[offset]! +
    0.7152 * image.data[offset + 1]! +
    0.0722 * image.data[offset + 2]!
  );
}

function equalSplits(top: number, bottom: number, count: number): number[] {
  const n = Math.max(1, count);
  const step = (bottom - top) / n;
  return Array.from({ length: n + 1 }, (_, index) => Math.round(top + index * step));
}

/** Detect list/card rows from a PNG. Status and home-indicator bands are ignored. */
export function proposeVisualRows(png: Uint8Array): ProposedVisualRow[] {
  let image: PNG;
  try {
    image = PNG.sync.read(Buffer.from(png));
  } catch {
    return [];
  }
  if (image.width < 80 || image.height < 160) return [];

  const topCut = Math.floor(image.height * 0.08);
  const bottomCut = Math.floor(image.height * 0.96);
  const sampleX = Math.floor(image.width * 0.5);
  const luma: number[] = [];
  for (let y = 0; y < image.height; y++) luma.push(lumaAt(image, sampleX, y));

  const bands: Array<[number, number]> = [];
  let inBand = false;
  let start = topCut;
  for (let y = topCut; y < bottomCut; y++) {
    const card = luma[y]! > 18;
    if (card && !inBand) {
      inBand = true;
      start = y;
    } else if (!card && inBand) {
      inBand = false;
      if (y - start >= 36) bands.push([start, y]);
    }
  }
  if (inBand && bottomCut - start >= 36) bands.push([start, bottomCut]);

  const tapX = Math.round(image.width * 0.26);
  const rows: ProposedVisualRow[] = [];
  for (const [bandTop, bandBottom] of bands) {
    const height = bandBottom - bandTop;
    const seps: number[] = [];
    for (let y = bandTop + 10; y < bandBottom - 10; y++) {
      if (luma[y]! < 22 && luma[y]! < luma[y - 3]! - 6) {
        if (!seps.length || y - seps[seps.length - 1]! > 24) seps.push(y);
      }
    }
    const estimated = Math.max(1, Math.round(height / Math.max(72, image.height * 0.067)));
    const edges =
      seps.length > 0
        ? [bandTop, ...seps, bandBottom]
        : equalSplits(bandTop, bandBottom, estimated);
    for (let index = 0; index < edges.length - 1; index++) {
      const top = edges[index]!;
      const bottom = edges[index + 1]!;
      if (bottom - top < 40) continue;
      rows.push({
        x: tapX,
        y: Math.round((top + bottom) / 2),
        top,
        bottom,
        height: bottom - top,
      });
    }
  }
  return rows.slice(0, 24);
}
