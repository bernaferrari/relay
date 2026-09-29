import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { comparePng, decodedVideoFrameRegion } from "./product-visual-comparison.mjs";

const { PNG } = createRequire(new URL("../packages/core/package.json", import.meta.url))("pngjs");

function image(width = 4, height = 4) {
  const png = new PNG({ width, height });
  for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = 255;
  return png;
}

test("decoded video pixels are ignored while player controls and nearby UI remain checked", () => {
  const expected = image();
  const actual = image();
  actual.data[(1 * 4 + 1) * 4] = 255;
  const region = { left: 1, top: 1, right: 3, bottom: 3 };
  assert.equal(
    comparePng(PNG, PNG.sync.write(expected), PNG.sync.write(actual), region).differentPixels,
    0,
  );

  actual.data[0] = 255;
  const result = comparePng(PNG, PNG.sync.write(expected), PNG.sync.write(actual), region);
  assert.equal(result.differentPixels, 1);
  assert.equal(result.ratio, 1 / 12);
});

test("video frame exclusion reserves the player border and controls", () => {
  assert.deepEqual(decodedVideoFrameRegion({ x: 20, y: 30, width: 200, height: 120 }), {
    left: 26,
    top: 36,
    right: 214,
    bottom: 86,
  });
  assert.throws(() => decodedVideoFrameRegion(null), /no usable frame bounds/u);
});
