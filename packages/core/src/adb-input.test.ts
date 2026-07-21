import assert from "node:assert/strict";
import test from "node:test";
import { adbSwipeInputArgs } from "./adb-input.js";

test("ADB swipe arguments are finite integers", () => {
  assert.deepEqual(adbSwipeInputArgs({ x: 492.2, y: 937 }, { x: 628, y: 2375.4 }, 334.5), [
    "input",
    "swipe",
    "492",
    "937",
    "628",
    "2375",
    "335",
  ]);
});

test("ADB swipe duration never reaches zero", () => {
  assert.equal(adbSwipeInputArgs({ x: 0, y: 0 }, { x: 1, y: 1 }, 0).at(-1), "1");
});

test("ADB swipe rejects non-finite input", () => {
  assert.throws(
    () => adbSwipeInputArgs({ x: 0, y: 0 }, { x: 1, y: 1 }, Number.NaN),
    /durationMs must be a finite number/,
  );
});
