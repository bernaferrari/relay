import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import {
  annotateTapPreview,
  annotateVisitedRows,
  mapTapPreviewToPixels,
  tapPreviewLogicalBounds,
} from "./tap-preview.js";

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

test("logical iPad points scale onto a 2x screenshot only when bounds are known", () => {
  const mapped = mapTapPreviewToPixels(
    { x: 78, y: 88 },
    { width: 1668, height: 2224 },
    { width: 834, height: 1112 },
  );
  assert.equal(mapped.scale, 2);
  assert.equal(mapped.x, 156);
  assert.equal(mapped.y, 176);
});

test("Android screenshot pixels match tap units without a 2x guess", () => {
  const mapped = mapTapPreviewToPixels({ x: 281, y: 330 }, { width: 1080, height: 2340 });
  assert.equal(mapped.scale, 1);
  assert.equal(mapped.x, 281);
  assert.equal(mapped.y, 330);
});

test("explicit logical bounds matching the image stay 1:1", () => {
  const mapped = mapTapPreviewToPixels(
    { x: 78, y: 88 },
    { width: 1668, height: 2224 },
    { width: 1668, height: 2224 },
  );
  assert.equal(mapped.x, 78);
  assert.equal(mapped.y, 88);
});

test("scales a Retina raster against its known logical viewport", () => {
  // 1668×2224 pixels is an 834×1112-point iPad at 2×. Without the PNG check
  // wiring, the ring would paint at half scale in the wrong quadrant.
  const logical = tapPreviewLogicalBounds(solidPng(1668, 2224, [0, 0, 0]), {
    width: 834,
    height: 1112,
  });
  assert.deepEqual(logical, { width: 834, height: 1112 });
  const mapped = mapTapPreviewToPixels({ x: 78, y: 88 }, { width: 1668, height: 2224 }, logical);
  assert.equal(mapped.scale, 2);
  assert.equal(mapped.x, 156);
  assert.equal(mapped.y, 176);
});

test("rejects a same-ratio raster whose orientation opposes the logical space", () => {
  const logical = tapPreviewLogicalBounds(solidPng(2224, 1668, [0, 0, 0]), {
    width: 834,
    height: 1112,
  });
  assert.equal(logical, undefined);
});

test("rejects a raster whose shape cannot be the known logical space", () => {
  // A portrait raster cannot be a landscape interaction space at any scale;
  // annotating it with those points would draw fiction.
  const logical = tapPreviewLogicalBounds(solidPng(1080, 2340, [0, 0, 0]), {
    width: 1112,
    height: 834,
  });
  assert.equal(logical, undefined);
});

test("annotating a Retina frame lands its ring on the tapped control", () => {
  // Logical point (40,40) inside an 80×80-point viewport captured at
  // 160×160 pixels must paint near pixel (80,80), not (40,40).
  const original = solidPng(160, 160, [10, 20, 30]);
  const marked = annotateTapPreview(original, { x: 40, y: 40 }, { width: 80, height: 80 });
  const before = PNG.sync.read(original);
  const after = PNG.sync.read(marked);
  assert.notEqual(after.data[(160 * 80 + 80) << 2], before.data[(160 * 80 + 80) << 2]);
  assert.equal(after.data[(160 * 40 + 40) << 2], before.data[(160 * 40 + 40) << 2]);
});

test("preview paints a ring without changing the rest of the frame", () => {
  const original = solidPng(80, 80, [10, 20, 30]);
  const marked = annotateTapPreview(original, { x: 40, y: 40 });
  const before = PNG.sync.read(original);
  const after = PNG.sync.read(marked);
  assert.equal(after.width, 80);
  assert.equal(after.height, 80);
  const onRing = (80 * 40 + 40) << 2;
  assert.notEqual(after.data[onRing], before.data[onRing]);
  const corner = (80 * 2 + 2) << 2;
  assert.equal(after.data[corner], before.data[corner]);
  assert.equal(after.data[corner + 1], before.data[corner + 1]);
});

test("visited rows wash the opened control without wiping the frame", () => {
  const original = solidPng(80, 80, [10, 20, 30]);
  const marked = annotateVisitedRows(original, [
    { bounds: { x: 10, y: 20, width: 40, height: 16 } },
  ]);
  const before = PNG.sync.read(original);
  const after = PNG.sync.read(marked);
  const inside = (80 * 28 + 20) << 2;
  assert.notEqual(after.data[inside], before.data[inside]);
  const corner = (80 * 2 + 2) << 2;
  assert.equal(after.data[corner], before.data[corner]);
});

test("preview can outline a resolved control bounds", () => {
  const original = solidPng(80, 80, [10, 20, 30]);
  const marked = annotateTapPreview(original, {
    point: { x: 40, y: 40 },
    bounds: { x: 20, y: 20, width: 40, height: 30 },
  });
  const before = PNG.sync.read(original);
  const after = PNG.sync.read(marked);
  // The outline sits outside the control so it does not obscure its text.
  const edge = (80 * 17 + 40) << 2;
  assert.notEqual(after.data[edge], before.data[edge]);
});
