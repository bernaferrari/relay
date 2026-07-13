import assert from "node:assert/strict";
import test from "node:test";
import { nextRovingIndex } from "./roving-focus";

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
