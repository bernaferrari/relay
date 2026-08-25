/**
 * Dry-run overlay: paint a tap target on a screenshot without touching the device.
 */
import { PNG } from "pngjs";

import { pngDimensions } from "./ios-geometry.js";

export type TapPreviewPoint = { x: number; y: number; label?: string };

export type TapPreviewMark = {
  point?: { x: number; y: number };
  points?: Array<{ x: number; y: number }>;
  bounds?: { x: number; y: number; width: number; height: number };
};

export function mapTapPreviewToPixels(
  point: { x: number; y: number },
  image: { width: number; height: number },
  logical?: { width: number; height: number },
): { x: number; y: number; scale: number } {
  // Mark uses the same units as a tap. Only scale when the caller knows the
  // screenshot is a different pixel size than the interaction space (iOS
  // logical points vs PNG). Guessing 2× from "upper-left 35% of a large
  // image" doubled Android taps on 1080×2340 screenshots.
  if (logical && logical.width > 0 && logical.height > 0) {
    return {
      x: Math.round((point.x * image.width) / logical.width),
      y: Math.round((point.y * image.height) / logical.height),
      scale: image.width / logical.width,
    };
  }
  return { x: Math.round(point.x), y: Math.round(point.y), scale: 1 };
}

/**
 * Logical interaction space for annotating a raster. The caller supplies the
 * logical size it already knows (AX geometry, snapshot bounds, recorded
 * viewport); the measured PNG dimensions confirm the raster really is that
 * same-aspect interaction space before the mark is trusted 1:1. A Retina
 * capture (pixels at 2–3× the logical viewport) then scales correctly instead
 * of painting its ring in the top-left quadrant; Android pixels and taps
 * share units, so a matching raster stays unscaled.
 */
export function tapPreviewLogicalBounds(
  bytes: Buffer,
  knownLogical?: { width: number; height: number },
): { width: number; height: number } | undefined {
  if (!knownLogical || knownLogical.width <= 0 || knownLogical.height <= 0) return undefined;
  const dimensions = pngDimensions(bytes);
  if (!dimensions) return undefined;
  const aspect = (value: { width: number; height: number }): number =>
    Math.min(value.width, value.height) / Math.max(value.width, value.height);
  // Same shape (within ~1%) means points and pixels share one orientation and
  // only a scale factor differs — exactly what mapTapPreviewToPixels applies.
  return Math.abs(aspect(dimensions) - aspect(knownLogical)) < 0.01 ? knownLogical : undefined;
}

function mixPixel(
  png: PNG,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  const alpha = a / 255;
  png.data[i] = Math.round(png.data[i]! * (1 - alpha) + r * alpha);
  png.data[i + 1] = Math.round(png.data[i + 1]! * (1 - alpha) + g * alpha);
  png.data[i + 2] = Math.round(png.data[i + 2]! * (1 - alpha) + b * alpha);
}

function drawRect(
  png: PNG,
  rect: { x: number; y: number; width: number; height: number },
  thickness: number,
  color: { r: number; g: number; b: number; a: number },
): void {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const x1 = Math.round(rect.x + rect.width);
  const y1 = Math.round(rect.y + rect.height);
  for (let t = 0; t < thickness; t += 1) {
    for (let x = x0; x <= x1; x += 1) {
      mixPixel(png, x, y0 + t, color.r, color.g, color.b, color.a);
      mixPixel(png, x, y1 - t, color.r, color.g, color.b, color.a);
    }
    for (let y = y0; y <= y1; y += 1) {
      mixPixel(png, x0 + t, y, color.r, color.g, color.b, color.a);
      mixPixel(png, x1 - t, y, color.r, color.g, color.b, color.a);
    }
  }
}

function fillRect(
  png: PNG,
  rect: { x: number; y: number; width: number; height: number },
  color: { r: number; g: number; b: number; a: number },
): void {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(png.width - 1, Math.round(rect.x + rect.width));
  const y1 = Math.min(png.height - 1, Math.round(rect.y + rect.height));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      mixPixel(png, x, y, color.r, color.g, color.b, color.a);
    }
  }
}

function drawRing(
  png: PNG,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  color: { r: number; g: number; b: number; a: number },
): void {
  const outer = radius + thickness;
  const inner = Math.max(0, radius - thickness);
  const x0 = Math.floor(cx - outer);
  const y0 = Math.floor(cy - outer);
  const x1 = Math.ceil(cx + outer);
  const y1 = Math.ceil(cy + outer);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= outer && d >= inner) mixPixel(png, x, y, color.r, color.g, color.b, color.a);
    }
  }
}

function isTapPreviewPoint(mark: TapPreviewPoint | TapPreviewMark): mark is TapPreviewPoint {
  return (
    typeof (mark as TapPreviewPoint).x === "number" &&
    typeof (mark as TapPreviewPoint).y === "number"
  );
}

function asMark(mark: TapPreviewPoint | TapPreviewMark): TapPreviewMark {
  if (isTapPreviewPoint(mark)) return { point: { x: mark.x, y: mark.y } };
  return mark;
}

/** Draw where a tap/selection would land. Does not mutate the device. */
export function annotateTapPreview(
  pngBytes: Buffer,
  mark: TapPreviewPoint | TapPreviewMark,
  logical?: { width: number; height: number },
): Buffer {
  const png = PNG.sync.read(pngBytes);
  const preview = asMark(mark);
  const ink = { r: 255, g: 80, b: 60, a: 230 };
  const radius = Math.max(16, Math.round(Math.min(png.width, png.height) * 0.028));
  if (preview.bounds && preview.bounds.width > 2 && preview.bounds.height > 2) {
    const topLeft = mapTapPreviewToPixels(
      { x: preview.bounds.x, y: preview.bounds.y },
      png,
      logical,
    );
    const bottomRight = mapTapPreviewToPixels(
      {
        x: preview.bounds.x + preview.bounds.width,
        y: preview.bounds.y + preview.bounds.height,
      },
      png,
      logical,
    );
    drawRect(
      png,
      {
        x: topLeft.x,
        y: topLeft.y,
        width: Math.max(2, bottomRight.x - topLeft.x),
        height: Math.max(2, bottomRight.y - topLeft.y),
      },
      Math.max(3, Math.round(radius * 0.16)),
      ink,
    );
  }
  const points = [...(preview.point ? [preview.point] : []), ...(preview.points ?? [])];
  for (const point of points) {
    const mapped = mapTapPreviewToPixels(point, png, logical);
    drawRing(png, mapped.x, mapped.y, radius, Math.max(3, Math.round(radius * 0.18)), ink);
    drawRing(png, mapped.x, mapped.y, Math.max(4, Math.round(radius * 0.22)), 2, {
      r: 255,
      g: 255,
      b: 255,
      a: 240,
    });
  }
  return PNG.sync.write(png);
}

/** Paint every already-opened row so a later screenshot still shows where the crawl went. */
export function annotateVisitedRows(
  pngBytes: Buffer,
  rows: Array<{ bounds: { x: number; y: number; width: number; height: number } }>,
  logical?: { width: number; height: number },
): Buffer {
  if (!rows.length) return pngBytes;
  const png = PNG.sync.read(pngBytes);
  const wash = { r: 220, g: 28, b: 36, a: 78 };
  const ink = { r: 255, g: 72, b: 64, a: 230 };
  const thickness = Math.max(3, Math.round(Math.min(png.width, png.height) * 0.004));
  for (const row of rows) {
    if (row.bounds.width < 2 || row.bounds.height < 2) continue;
    const topLeft = mapTapPreviewToPixels({ x: row.bounds.x, y: row.bounds.y }, png, logical);
    const bottomRight = mapTapPreviewToPixels(
      {
        x: row.bounds.x + row.bounds.width,
        y: row.bounds.y + row.bounds.height,
      },
      png,
      logical,
    );
    const rect = {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.max(2, bottomRight.x - topLeft.x),
      height: Math.max(2, bottomRight.y - topLeft.y),
    };
    fillRect(png, rect, wash);
    drawRect(png, rect, thickness, ink);
  }
  return PNG.sync.write(png);
}
