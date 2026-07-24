import assert from "node:assert/strict";
import test from "node:test";
import { diffRgba } from "./visual-diff.js";

test("visual diff ignores identical pixels and reports changed bounds", () => {
  const baseline = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  const current = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  current.data[12] = 255;
  const result = diffRgba(baseline, current);
  assert.equal(result.changedPixels, 1);
  assert.equal(result.ratio, 0.25);
  assert.deepEqual(result.bounds, { x: 1, y: 1, width: 1, height: 1 });
});
