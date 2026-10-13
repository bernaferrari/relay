import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { analyzeScreenshot, MAX_SCREENSHOT_ANALYSIS_BYTES } from "./screenshot-analysis.js";
import { analyzeScreenshotAsync } from "./screenshot-analysis-async.js";

test("large raster analysis lets host I/O run and returns the unchanged synchronous metadata", async () => {
  const image = new PNG({ width: 1000, height: 1100 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = (offset % 197) + 5;
    image.data[offset + 1] = 22;
    image.data[offset + 2] = 33;
    image.data[offset + 3] = 255;
  }
  const bytes = PNG.sync.write(image);
  const original = Buffer.from(bytes);
  const expected = analyzeScreenshot(bytes);
  let hostIoRan = false;
  const timer = setTimeout(() => {
    hostIoRan = true;
  }, 0);
  try {
    assert.deepEqual(await analyzeScreenshotAsync(bytes), expected);
    assert.equal(hostIoRan, true, "decoding may not hold the host event loop until its result");
    assert.deepEqual(bytes, original);
  } finally {
    clearTimeout(timer);
  }
  assert.deepEqual(await analyzeScreenshotAsync(Buffer.from("not a png")), { blank: false });
});

test("oversized input and unsafe IHDR allocations are rejected before any decoder or worker", async () => {
  const oversized = Buffer.alloc(MAX_SCREENSHOT_ANALYSIS_BYTES + 1);
  assert.throws(() => analyzeScreenshot(oversized), /32 MiB analysis byte limit/);
  await assert.rejects(analyzeScreenshotAsync(oversized), /32 MiB analysis byte limit/);
  for (const [width, height] of [
    [16_385, 1],
    [1, 16_385],
    [8192, 8192],
    [0xffff_ffff, 0xffff_ffff],
  ]) {
    const header = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(width!, 16);
    header.writeUInt32BE(height!, 20);
    header[24] = 16;
    header[25] = 2;
    assert.throws(() => analyzeScreenshot(header), /analysis dimension limit/);
    await assert.rejects(analyzeScreenshotAsync(header), /analysis dimension limit/);
  }
});

test("a later IHDR cannot replace the dimensions checked before decoding", async () => {
  const png = (width: number): Buffer => {
    const image = new PNG({ width, height: 1 });
    image.data.fill(255);
    return PNG.sync.write(image);
  };
  const small = png(1);
  const wide = png(16_385);
  const duplicateIhdr = Buffer.concat([small.subarray(0, 33), wide.subarray(8)]);
  assert.equal(duplicateIhdr.length, 169);
  assert.throws(() => analyzeScreenshot(duplicateIhdr), /duplicate IHDR/);
  await assert.rejects(analyzeScreenshotAsync(duplicateIhdr), /duplicate IHDR/);
});
