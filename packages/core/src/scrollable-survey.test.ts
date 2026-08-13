import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { captureScrollableSurvey, verticalScrollSeam } from "./scrollable-survey.js";

function image(offset: number): Buffer {
  const png = new PNG({ width: 64, height: 160 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (y * png.width + x) * 4;
      const value = (y + offset + x * 7) % 255;
      png.data[index] = value;
      png.data[index + 1] = (value * 3) % 255;
      png.data[index + 2] = (value * 5) % 255;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test("finds a vertical overlap and detects an unchanged terminal viewport", () => {
  assert.equal(verticalScrollSeam(image(0), image(0))?.shiftY, 0);
  const seam = verticalScrollSeam(image(0), image(40));
  assert.ok(seam);
  assert.ok(Math.abs(seam!.shiftY - 40) <= 2);
});

test("scroll survey preserves original frames and restores after reaching the end", async () => {
  const pages = [image(0), image(40), image(40)];
  let page = 0;
  let up = 0;
  const result = await captureScrollableSurvey({
    capture: async () => ({
      screenshot: {
        base64: pages[page]!.toString("base64"),
        width: 64,
        height: 160,
        capturedAt: page,
      },
      snapshot: {
        capturedAt: page,
        nodes: [
          { identifier: "toolbar", type: "Button", rect: { x: 0, y: 0, width: 20, height: 20 } },
        ],
        interactive: [],
        bounds: { width: 64, height: 160 },
        inspectable: true,
        source: "sdk",
        screenIdentity: { fingerprint: `screen-${page}`, nodes: [], volatileSignals: [] },
      },
    }),
    scrollDown: async () => {
      page = Math.min(page + 1, pages.length - 1);
    },
    scrollUp: async () => {
      up += 1;
    },
    settle: async () => {},
  });
  assert.equal(result.status, "completed");
  assert.equal(result.reason, "end-of-content");
  assert.equal(result.frames.length, 2);
  assert.equal(up, 1);
  assert.ok(result.stitched);
});
