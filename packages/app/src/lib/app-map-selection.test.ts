import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasSelectionRect,
  connectionIdsInSelection,
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

const geometries = {
  account: {
    width: 240,
    height: 230,
    frameLeft: 64,
    frameTop: 30,
    frameWidth: 112,
    frameHeight: 200,
    mediaWidth: 112,
    mediaHeight: 200,
  },
  security: {
    width: 240,
    height: 230,
    frameLeft: 64,
    frameTop: 30,
    frameWidth: 112,
    frameHeight: 200,
    mediaWidth: 112,
    mediaHeight: 200,
  },
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

test("marquee selection includes a connection curve it crosses", () => {
  const selection = canvasSelectionRect({ x: 190, y: 90 }, { x: 210, y: 120 });
  assert.deepEqual(
    connectionIdsInSelection(
      [
        {
          id: "path",
          hitPoints: [
            { x: 0, y: 100 },
            { x: 400, y: 100 },
          ],
        },
        {
          id: "outside",
          hitPoints: [
            { x: 0, y: 300 },
            { x: 400, y: 300 },
          ],
        },
      ],
      selection,
    ),
    ["path"],
  );
});

test("marquee does not select a collinear connection outside its bounds", () => {
  const selection = canvasSelectionRect({ x: 190, y: 90 }, { x: 210, y: 120 });
  assert.deepEqual(
    connectionIdsInSelection(
      [
        {
          id: "outside",
          hitPoints: [
            { x: 0, y: 100 },
            { x: 100, y: 100 },
          ],
        },
      ],
      selection,
    ),
    [],
  );
});

test("temporary multi-selection gets a close collective outline", () => {
  assert.deepEqual(selectedScreensRect(["account", "security"], positions), {
    left: 94,
    top: 124,
    right: 586,
    bottom: 330,
    width: 492,
    height: 206,
  });
});

test("marquee and collective outlines ignore screen titles and use preview frames", () => {
  const titleOnly = canvasSelectionRect({ x: 100, y: 100 }, { x: 250, y: 124 });
  assert.deepEqual(screenIdsInSelection(["account"], positions, titleOnly, geometries), []);
  assert.deepEqual(selectedScreensRect(["account", "security"], positions, geometries), {
    left: 158,
    top: 124,
    right: 522,
    bottom: 356,
    width: 364,
    height: 232,
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
