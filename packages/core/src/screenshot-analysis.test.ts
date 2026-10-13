import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { analyzeScreenshot } from "./screenshot-analysis.js";
import { isBlankScreenshot } from "./workspace-capture-presentation.js";
import { observeVisualScreenFingerprint } from "./screen-identity-visual.js";

function raster(options: { panel?: number; black?: boolean; alpha?: number } = {}): Buffer {
  const png = new PNG({ width: 64, height: 96 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const value = options.black ? 0 : x < (options.panel ?? 22) && y < 30 ? 220 : 18;
      png.data[offset] = value;
      png.data[offset + 1] = value;
      png.data[offset + 2] = value;
      png.data[offset + 3] = options.alpha ?? 255;
    }
  }
  return PNG.sync.write(png);
}

test("shared raster analysis preserves v1 identity, blank classification, and byte integrity", () => {
  const bytes = raster();
  const original = Buffer.from(bytes);
  const analyzed = analyzeScreenshot(bytes);
  assert.deepEqual(bytes, original);
  assert.equal(analyzed.blank, false);
  assert.deepEqual(analyzed.dimensions, { width: 64, height: 96 });
  assert.equal(
    analyzed.visualFingerprint,
    "f00f8be9ef7d5e2f92e0933c58ff063b9cb23c149fe0f3d83c560ef7de165c42",
  );
  assert.equal(analyzed.visualFingerprint, observeVisualScreenFingerprint(bytes));
  assert.equal(analyzed.blank, isBlankScreenshot(bytes));
  assert.notEqual(
    analyzed.visualFingerprint,
    analyzeScreenshot(raster({ panel: 32 })).visualFingerprint,
  );
  assert.equal(analyzeScreenshot(raster({ black: true })).blank, true);
  assert.equal(analyzeScreenshot(raster({ alpha: 0 })).blank, true);
  assert.deepEqual(analyzeScreenshot(Buffer.from("not a png")), { blank: false });
});

test("analysis holds metadata alone and never lends a former capture's identity to new bytes", () => {
  const bytes = raster();
  const first = analyzeScreenshot(bytes);
  const changed = raster({ panel: 32 });
  // Reusing an allocation is not evidence that its content is unchanged.
  const allocation = Buffer.alloc(Math.max(bytes.length, changed.length));
  bytes.copy(allocation);
  const before = analyzeScreenshot(allocation.subarray(0, bytes.length));
  changed.copy(allocation);
  const after = analyzeScreenshot(allocation.subarray(0, changed.length));
  assert.equal(before.visualFingerprint, first.visualFingerprint);
  assert.notEqual(after.visualFingerprint, first.visualFingerprint);
  assert.deepEqual(Object.keys(first).sort(), ["blank", "dimensions", "visualFingerprint"]);
});

test("16-bit samples use exactly the former pngjs rescaling for blank checks and v1 hashes", () => {
  for (const solid of [undefined, 0, 1, 127, 128, 256, 1_156, 1_157]) {
    const image = new PNG({ width: 32, height: 48 });
    const channels = new Uint16Array(image.width * image.height * 4);
    for (let index = 0; index < channels.length; index += 4) {
      channels[index] = solid ?? (index * 137) % 65_536;
      channels[index + 1] = solid ?? (index * 863) % 65_536;
      channels[index + 2] = solid ?? (index * 337) % 65_536;
      channels[index + 3] = 65_535;
    }
    image.data = Buffer.from(channels.buffer);
    const bytes = PNG.sync.write(image, { bitDepth: 16 });
    const original = Buffer.from(bytes);
    const legacyRescaled = PNG.sync.read(bytes);
    const legacyEightBitPng = PNG.sync.write(legacyRescaled);
    assert.equal(bytes[24], 16);
    assert.deepEqual(analyzeScreenshot(bytes), analyzeScreenshot(legacyEightBitPng));
    assert.deepEqual(bytes, original);
  }
});
