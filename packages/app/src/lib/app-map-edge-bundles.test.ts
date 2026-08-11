import assert from "node:assert/strict";
import test from "node:test";
import { buildCrossGroupEdgeBundles } from "./app-map-edge-bundles";

test("collapses many cross-group paths into one directional route", () => {
  const bundles = buildCrossGroupEdgeBundles(
    [
      { id: "a-c", fromScreenId: "a", toScreenId: "c" },
      { id: "b-d", fromScreenId: "b", toScreenId: "d" },
      { id: "a-b", fromScreenId: "a", toScreenId: "b" },
    ],
    [
      { id: "left", screenIds: ["a", "b"] },
      { id: "right", screenIds: ["c", "d"] },
    ],
    {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 300 },
      c: { x: 600, y: 0 },
      d: { x: 600, y: 300 },
    },
  );

  assert.equal(bundles.length, 1);
  assert.deepEqual(bundles[0]?.connectionIds, ["a-c", "b-d"]);
  assert.match(bundles[0]?.path ?? "", /^M 240 /);
});

test("keeps opposite directions distinct", () => {
  const bundles = buildCrossGroupEdgeBundles(
    [
      { id: "a-c", fromScreenId: "a", toScreenId: "c" },
      { id: "c-a", fromScreenId: "c", toScreenId: "a" },
    ],
    [
      { id: "left", screenIds: ["a"] },
      { id: "right", screenIds: ["c"] },
    ],
    { a: { x: 0, y: 0 }, c: { x: 600, y: 0 } },
  );

  assert.deepEqual(bundles.map((bundle) => bundle.id).sort(), ["left->right", "right->left"]);
});

test("uses bottom and top ports for vertically stacked groups", () => {
  const bundles = buildCrossGroupEdgeBundles(
    [{ id: "top-bottom", fromScreenId: "top", toScreenId: "bottom" }],
    [
      { id: "upper", screenIds: ["top"] },
      { id: "lower", screenIds: ["bottom"] },
    ],
    { top: { x: 0, y: 0 }, bottom: { x: 0, y: 600 } },
  );

  assert.equal(bundles.length, 1);
  assert.match(bundles[0]?.path ?? "", /^M 120 230 C 120 /);
  assert.match(bundles[0]?.path ?? "", /, 120 600$/);
});
