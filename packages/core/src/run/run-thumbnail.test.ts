import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { contentBox, contentThumbnail } from "./run-thumbnail.js";

function page(width: number, height: number, paint: (x: number, y: number) => number[]) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r!;
      png.data[i + 1] = g!;
      png.data[i + 2] = b!;
      png.data[i + 3] = 255;
    }
  return png;
}

test("finds content on a mostly empty page and crops to it", () => {
  // White page with a dark heading block in the top-left corner.
  const image = page(1440, 900, (x, y) =>
    x >= 60 && x < 460 && y >= 40 && y < 120 ? [20, 20, 20] : [255, 255, 255],
  );
  const box = contentBox(image)!;
  assert.ok(box.x <= 60 && box.x > 0 && box.y <= 40 && box.width < 520, JSON.stringify(box));
  const thumb = PNG.sync.read(contentThumbnail(PNG.sync.write(image)));
  assert.equal(thumb.width, 192);
  assert.equal(thumb.height, 132);
  // The heading fills a real share of the thumbnail instead of a few pixels.
  let dark = 0;
  for (let i = 0; i < thumb.data.length; i += 4) if (thumb.data[i]! < 128) dark++;
  assert.ok(dark / (thumb.width * thumb.height) > 0.1, `dark share ${dark}`);
});

test("keeps a full-bleed phone screen whole from the top", () => {
  const image = page(390, 844, (_x, y) => (y < 422 ? [10, 10, 40] : [200, 30, 30]));
  const thumb = PNG.sync.read(contentThumbnail(PNG.sync.write(image)));
  assert.equal(thumb.width, 192);
  // Top of the phone leads.
  assert.ok(thumb.data[2]! > 30 && thumb.data[0]! < 30);
});
