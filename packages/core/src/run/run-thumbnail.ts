import { PNG } from "pngjs";

export type ThumbnailOptions = {
  /** Output width in pixels. */
  width?: number;
  /** Output width / height. */
  aspect?: number;
  /** Smallest crop, as a share of the screenshot width, so one icon is never blown up. */
  minShare?: number;
};

type Box = { x: number; y: number; width: number; height: number };

/**
 * A small, recognizable picture of a screenshot. Web pages are mostly empty
 * background at thumbnail size, so crop to where the content is, keep the
 * requested aspect, and downsample by averaging.
 */
export function contentThumbnail(png: Buffer, options: ThumbnailOptions = {}): Buffer {
  const width = options.width ?? 192;
  const aspect = options.aspect ?? 16 / 11;
  const image = PNG.sync.read(png);
  const crop = fitAspect(
    contentBox(image) ?? { x: 0, y: 0, width: image.width, height: image.height },
    image,
    aspect,
    options.minShare ?? 0.4,
  );
  const height = Math.max(1, Math.round(width / aspect));
  const out = new PNG({ width, height });
  for (let oy = 0; oy < height; oy++) {
    const y0 = crop.y + (oy * crop.height) / height;
    const y1 = crop.y + ((oy + 1) * crop.height) / height;
    for (let ox = 0; ox < width; ox++) {
      const x0 = crop.x + (ox * crop.width) / width;
      const x1 = crop.x + ((ox + 1) * crop.width) / width;
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let y = Math.floor(y0); y < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); y++) {
        for (let x = Math.floor(x0); x < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); x++) {
          const i =
            (Math.min(y, image.height - 1) * image.width + Math.min(x, image.width - 1)) * 4;
          r += image.data[i]!;
          g += image.data[i + 1]!;
          b += image.data[i + 2]!;
          a += image.data[i + 3]!;
          n++;
        }
      }
      const o = (oy * width + ox) * 4;
      out.data[o] = r / n;
      out.data[o + 1] = g / n;
      out.data[o + 2] = b / n;
      out.data[o + 3] = a / n;
    }
  }
  return PNG.sync.write(out);
}

/** Bounding box of pixels that differ from the background (the corners' colour). */
export function contentBox(image: {
  width: number;
  height: number;
  data: Buffer;
}): Box | undefined {
  const { width, height, data } = image;
  if (width < 4 || height < 4) return undefined;
  const at = (x: number, y: number) => (y * width + x) * 4;
  const corners = [at(1, 1), at(width - 2, 1), at(1, height - 2), at(width - 2, height - 2)];
  // The most common corner colour is the page background.
  const background = corners
    .map((i) => [data[i]!, data[i + 1]!, data[i + 2]!] as const)
    .map((color, _, all) => ({
      color,
      votes: all.filter((other) => distance(color, other) < 24).length,
    }))
    .sort((left, right) => right.votes - left.votes)[0]!.color;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = at(x, y);
      if (distance(background, [data[i]!, data[i + 1]!, data[i + 2]!]) < 24) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return undefined;
  const pad = Math.round(Math.min(width, height) * 0.03);
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    width: Math.min(width, maxX + pad + step) - x,
    height: Math.min(height, maxY + pad + step) - y,
  };
}

function fitAspect(
  box: Box,
  image: { width: number; height: number },
  aspect: number,
  minShare: number,
): Box {
  let width = Math.max(box.width, image.width * minShare);
  let height = Math.max(box.height, width / aspect);
  width = Math.max(width, height * aspect);
  // The image may be narrower than the requested aspect (a phone); then fit
  // the width and let the top of the content lead.
  if (width > image.width) {
    width = image.width;
    height = width / aspect;
  }
  if (height > image.height) {
    height = image.height;
    width = Math.min(image.width, height * aspect);
  }
  const centerX = box.x + box.width / 2;
  const x = clamp(centerX - width / 2, 0, image.width - width);
  // Anchor to the top of the content: headers identify a screen best.
  const y = clamp(box.y, 0, image.height - height);
  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function distance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
}
