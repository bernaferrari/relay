import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { PNG } from "pngjs";
import { analyzeScreenshot } from "./screenshot-analysis.js";
import { analyzeScreenshotAsync } from "./screenshot-analysis-async.js";

const PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

function chunk(kind: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(kind, 4, "ascii");
  data.copy(out, 8);
  let crc = -1;
  for (const byte of out.subarray(4, out.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  out.writeInt32BE(crc ^ -1, out.length - 4);
  return out;
}

function interlacedPng(width: number, height: number, depth: 8 | 16, raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = 6;
  header[12] = 1;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("a tiny Adam7 header cannot allow unbounded IDAT expansion in either decode path", async () => {
  const raw = Buffer.alloc(8 * 1024 * 1024);
  for (const [width, height] of [
    [1, 1],
    [1000, 1100],
  ] as const) {
    const bytes = interlacedPng(width, height, 8, raw);
    assert.ok(bytes.length < 9000);
    assert.throws(() => analyzeScreenshot(bytes), /interlaced.*expansion limit/i);
    await assert.rejects(analyzeScreenshotAsync(bytes), /interlaced.*expansion limit/i);
  }
});

test("corrupt and zero-sized Adam7 streams never reach the unbounded decoder", () => {
  const bytes = interlacedPng(1, 1, 8, Buffer.from([0, 12, 13, 14, 255]));
  const compressed = Buffer.from(bytes.subarray(41, bytes.length - 16));
  compressed[compressed.length - 1] = compressed[compressed.length - 1]! ^ 1;
  const corrupt = Buffer.concat([
    bytes.subarray(0, 33),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const originalRead = PNG.sync.read;
  let decodeCalls = 0;
  PNG.sync.read = (...args) => {
    decodeCalls++;
    return originalRead(...args);
  };
  try {
    assert.deepEqual(analyzeScreenshot(corrupt), { blank: false });
    assert.deepEqual(analyzeScreenshot(interlacedPng(0, 1, 8, Buffer.alloc(0))), { blank: false });
    assert.equal(decodeCalls, 0);
  } finally {
    PNG.sync.read = originalRead;
  }
});

test("bounded Adam7 validation preserves valid 8-bit and 16-bit captures and narrow passes", async () => {
  for (const depth of [8, 16] as const) {
    for (const [width, height] of [
      [1, 1],
      [1, 17],
      [19, 1],
      [97, 193],
    ] as const) {
      const image = new PNG({ width, height });
      const rows: Buffer[] = [];
      for (const [startX, startY, stepX, stepY] of PASSES) {
        if (startX >= width || startY >= height) continue;
        for (let y = startY; y < height; y += stepY) {
          const values: number[] = [0];
          for (let x = startX; x < width; x += stepX) {
            const channels = [(x * 31 + y * 7) % 256, y % 256, x % 256, 255];
            image.data.set(channels, (y * width + x) * 4);
            for (const value of channels) {
              if (depth === 16) values.push(value, value);
              else values.push(value);
            }
          }
          rows.push(Buffer.from(values));
        }
      }
      const expected = analyzeScreenshot(PNG.sync.write(image));
      const bytes = interlacedPng(width, height, depth, Buffer.concat(rows));
      assert.deepEqual(analyzeScreenshot(bytes), expected, `${width}×${height}, ${depth}-bit`);
      assert.deepEqual(await analyzeScreenshotAsync(bytes), expected);
    }
  }
});
