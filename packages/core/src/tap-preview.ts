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
  // Portrait logical + landscape PNG can share that 3:4 ratio and still swap axes.
  const sameOrientation =
    dimensions.width > dimensions.height === knownLogical.width > knownLogical.height;
  return sameOrientation && Math.abs(aspect(dimensions) - aspect(knownLogical)) < 0.01
    ? knownLogical
    : undefined;
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
  const radius = Math.min(10, rect.width / 4, rect.height / 4);
  const halfWidth = rect.width / 2,
    halfHeight = rect.height / 2;
  for (
    let y = Math.max(0, Math.floor(rect.y - 1));
    y <= Math.min(png.height - 1, Math.ceil(rect.y + rect.height + 1));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(rect.x - 1));
      x <= Math.min(png.width - 1, Math.ceil(rect.x + rect.width + 1));
      x += 1
    ) {
      const qx = Math.abs(x - rect.x - halfWidth) - halfWidth + radius;
      const qy = Math.abs(y - rect.y - halfHeight) - halfHeight + radius;
      const distance =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      const coverage = Math.max(0, Math.min(1, thickness / 2 + 0.5 - Math.abs(distance)));
      if (coverage) mixPixel(png, x, y, color.r, color.g, color.b, color.a * coverage);
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
      const coverage = Math.min(1, Math.max(0, outer + 0.5 - d), Math.max(0, d - inner + 0.5));
      if (coverage > 0) mixPixel(png, x, y, color.r, color.g, color.b, color.a * coverage);
    }
  }
}

function drawPathLine(
  png: PNG,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  color: { r: number; g: number; b: number; a: number },
): void {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return;
  for (
    let y = Math.max(0, Math.floor(Math.min(from.y, to.y) - width));
    y <= Math.min(png.height - 1, Math.ceil(Math.max(from.y, to.y) + width));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(Math.min(from.x, to.x) - width));
      x <= Math.min(png.width - 1, Math.ceil(Math.max(from.x, to.x) + width));
      x += 1
    ) {
      const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared));
      const coverage = Math.max(
        0,
        Math.min(1, width / 2 + 0.5 - Math.hypot(x - from.x - t * dx, y - from.y - t * dy)),
      );
      if (coverage) mixPixel(png, x, y, color.r, color.g, color.b, color.a * coverage);
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
  const ink = { r: 59, g: 130, b: 246, a: 230 };
  const scale = Math.max(1, Math.min(png.width, png.height) / 400);
  const radius = 5 * scale;
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
        x: topLeft.x - 3 * scale,
        y: topLeft.y - 3 * scale,
        width: Math.max(2, bottomRight.x - topLeft.x) + 6 * scale,
        height: Math.max(2, bottomRight.y - topLeft.y) + 6 * scale,
      },
      Math.max(1, Math.round(scale)),
      ink,
    );
  }
  const path = (preview.points ?? []).map((point) => mapTapPreviewToPixels(point, png, logical));
  if (path.length > 1) {
    for (let index = 1; index < path.length; index += 1) {
      drawPathLine(png, path[index - 1]!, path[index]!, scale, ink);
    }
    const end = path.at(-1)!;
    const start = path.at(-2)!;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    for (const offset of [-0.65, 0.65]) {
      drawPathLine(
        png,
        end,
        {
          x: end.x - 8 * scale * Math.cos(angle + offset),
          y: end.y - 8 * scale * Math.sin(angle + offset),
        },
        scale,
        ink,
      );
    }
    drawRing(png, path[0]!.x, path[0]!.y, 2 * scale, scale / 2, ink);
  } else if (preview.point) {
    const mapped = mapTapPreviewToPixels(preview.point, png, logical);
    // Small, high-contrast center with a fine accent outline. Avoid covering
    // the control's label with a large warning-colored ring.
    drawRing(png, mapped.x, mapped.y, radius, scale * 0.7, { r: 15, g: 23, b: 42, a: 170 });
    drawRing(png, mapped.x, mapped.y, radius, scale * 0.45, ink);
    drawRing(png, mapped.x, mapped.y, 1.5 * scale, 1.5 * scale, { r: 255, g: 255, b: 255, a: 245 });
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
  const wash = { r: 59, g: 130, b: 246, a: 18 };
  const ink = { r: 59, g: 130, b: 246, a: 145 };
  const thickness = Math.max(1, Math.round(Math.min(png.width, png.height) / 400));
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
