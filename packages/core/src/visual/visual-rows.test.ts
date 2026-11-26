import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { proposeVisualRows, proposeVisualRowsFromDecodedRaster } from "./visual-rows.js";

function cardListPng(): Buffer {
  const png = new PNG({ width: 108, height: 234 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const inFirst = y >= 80 && y < 130;
      const inSecondTop = y >= 140 && y < 185;
      const inSecondBottom = y >= 190 && y < 230;
      const colour: readonly [number, number, number] =
        inFirst || inSecondTop || inSecondBottom ? [64, 64, 64] : [4, 4, 4];
      png.data[offset] = colour[0];
      png.data[offset + 1] = colour[1];
      png.data[offset + 2] = colour[2];
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test("proposed visual rows come from screenshot cards, not the status bar", () => {
  const rows = proposeVisualRows(cardListPng());
  assert.ok(rows.length >= 2, `expected at least two rows, got ${rows.length}`);
  assert.ok(rows.every((row) => row.y > 80 && row.y < 210));
  assert.ok(
    rows.every((row) => row.x < 108 / 2),
    "tap the label, not the trailing toggle",
  );
  assert.equal(proposeVisualRows(Buffer.from("not a png")).length, 0);
});

function sixteenBitPng(
  width: number,
  height: number,
  sample: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  const channels = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const [red, green, blue] = sample(x, y);
      channels[offset] = red;
      channels[offset + 1] = green;
      channels[offset + 2] = blue;
      channels[offset + 3] = 65_535;
    }
  }
  image.data = Buffer.from(channels.buffer);
  return PNG.sync.write(image, { bitDepth: 16 });
}

function assertDecodedRowEquivalence(bytes: Buffer): ReturnType<typeof proposeVisualRows> {
  const original = Buffer.from(bytes);
  const native = PNG.sync.read(bytes, { skipRescale: true });
  const legacy = PNG.sync.read(bytes);
  const legacyBytes = PNG.sync.write(legacy);
  assert.equal(bytes[24], 16);
  assert.equal(legacyBytes[24], 8);
  const expected = proposeVisualRows(legacyBytes);
  assert.deepEqual(proposeVisualRows(bytes), expected);
  assert.deepEqual(
    proposeVisualRowsFromDecodedRaster({
      width: legacy.width,
      height: legacy.height,
      data: legacy.data,
      sampleDepth: 8,
    }),
    expected,
  );
  assert.deepEqual(
    proposeVisualRowsFromDecodedRaster({
      width: native.width,
      height: native.height,
      data: native.data,
      sampleDepth: 16,
    }),
    expected,
  );
  assert.deepEqual(bytes, original);
  return expected;
}

test("decoded 16-bit rows preserve rounding at the card threshold", () => {
  // Preserve even the former luma arithmetic: gray 18 sums just above 18.
  for (const [sample, count] of [
    [4_497, 0], // rounds to 17
    [4_498, 3], // rounds to 18
    [4_754, 3], // last source value that rounds to 18
    [4_755, 3],
  ] as const) {
    const bytes = sixteenBitPng(108, 234, () => [sample, sample, sample]);
    assert.equal(assertDecodedRowEquivalence(bytes).length, count);
  }
});

test("decoded 8/16-bit centerlines preserve mixed bands, separator thresholds, and coordinates", () => {
  const bytes = sixteenBitPng(108, 600, (x, y) => {
    // Bright off-center pixels cannot turn the dark centerline into a card.
    if (x !== 54 || y < 48) return [65_535, 65_535, 65_535];
    if (y >= 80 && y < 220) {
      if (y === 140) return [5_525, 5_525, 5_525]; // rounds to 21: separator
      return [32 * 257, 32 * 257, 32 * 257];
    }
    if (y >= 260 && y < 420) {
      if (y === 330) return [5_525, 5_525, 5_525];
      if (y === 390) return [5_526, 5_526, 5_526]; // rounds to 22: no separator
      return [45 * 257 + 100, 32 * 257 - 100, 51 * 257 + 128];
    }
    if (y >= 460 && y < 560) return [4_755, 4_755, 4_755];
    return [4_497, 4_497, 4_497];
  });
  assert.deepEqual(assertDecodedRowEquivalence(bytes), [
    { x: 28, y: 110, top: 80, bottom: 140, height: 60 },
    { x: 28, y: 180, top: 140, bottom: 220, height: 80 },
    { x: 28, y: 295, top: 260, bottom: 330, height: 70 },
    { x: 28, y: 375, top: 330, bottom: 420, height: 90 },
    { x: 28, y: 510, top: 460, bottom: 560, height: 100 },
  ]);
});
