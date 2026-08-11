import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasSelectionRect,
  mergeSelectedScreenIds,
  selectionDetailsScreenId,
  screenIdsInSelection,
  selectedScreensRect,
} from "./app-map-selection";

const positions = {
  account: { x: 100, y: 100 },
  security: { x: 340, y: 120 },
  outside: { x: 800, y: 700 },
};

test("marquee geometry is stable in every drag direction", () => {
  assert.deepEqual(canvasSelectionRect({ x: 540, y: 500 }, { x: 80, y: 60 }), {
    left: 80,
    top: 60,
    right: 540,
    bottom: 500,
    width: 460,
    height: 440,
  });
});

test("marquee selection includes every screen it touches", () => {
  const selection = canvasSelectionRect({ x: 90, y: 90 }, { x: 350, y: 460 });
  assert.deepEqual(screenIdsInSelection(["account", "security", "outside"], positions, selection), [
    "account",
    "security",
  ]);
});

test("temporary multi-selection gets a close collective outline", () => {
  assert.deepEqual(selectedScreensRect(["account", "security"], positions), {
    left: 94,
    top: 94,
    right: 586,
    bottom: 356,
    width: 492,
    height: 262,
  });
});

test("shift-marquee adds to the current selection without duplicates", () => {
  assert.deepEqual(mergeSelectedScreenIds(["account"], ["account", "security"], true), [
    "account",
    "security",
  ]);
  assert.deepEqual(mergeSelectedScreenIds(["account"], ["security"], false), ["security"]);
});

test("marquee details open only for one unambiguous screen", () => {
  assert.equal(selectionDetailsScreenId(["account"]), "account");
  assert.equal(selectionDetailsScreenId([]), null);
  assert.equal(selectionDetailsScreenId(["account", "security"]), null);
});
