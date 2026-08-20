import assert from "node:assert/strict";
import test from "node:test";
import { nextGridRovingIndex, nextRovingIndex } from "./roving-focus";

test("wraps vertical picker navigation", () => {
  assert.equal(nextRovingIndex("ArrowDown", 2, 3, "vertical"), 0);
  assert.equal(nextRovingIndex("ArrowUp", 0, 3, "vertical"), 2);
});

test("supports horizontal tabs and boundary keys", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 3, "horizontal"), 1);
  assert.equal(nextRovingIndex("Home", 2, 3, "horizontal"), 0);
  assert.equal(nextRovingIndex("End", 0, 3, "horizontal"), 2);
  assert.equal(nextRovingIndex("ArrowDown", 0, 3, "horizontal"), null);
});

test("grid arrows stay inside a Combine matrix instead of wrapping the page", () => {
  assert.equal(nextGridRovingIndex("ArrowRight", 0, 3, 9), 1);
  assert.equal(nextGridRovingIndex("ArrowDown", 1, 3, 9), 4);
  assert.equal(nextGridRovingIndex("ArrowUp", 4, 3, 9), 1);
  assert.equal(nextGridRovingIndex("Home", 5, 3, 9), 3);
  assert.equal(nextGridRovingIndex("End", 3, 3, 9), 5);
  assert.equal(nextGridRovingIndex("ArrowRight", 8, 3, 9), 8);
});
