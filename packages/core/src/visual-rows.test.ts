import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { proposeVisualRows } from "./visual-rows.js";

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
