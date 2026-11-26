import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalAppMapCombineCellValues,
  canonicalAppMapTestTupleIdentity,
  compareUtf8Bytewise,
  parseAppMapTestTupleIdentity,
  sameAppMapCombineCellValues,
  sameAppMapTestTupleIdentity,
} from "./app-map-combine-cell.js";

test("Combine cell identity sorts variable ids bytewise", () => {
  assert.equal(compareUtf8Bytewise("a-b", "a_b") < 0, true);
  assert.deepEqual(Object.keys(canonicalAppMapCombineCellValues({ z: "1", a: "2" })), ["a", "z"]);
  assert.equal(
    sameAppMapCombineCellValues(
      { language: "en", theme: "dark" },
      { theme: "dark", language: "en" },
    ),
    true,
  );
  assert.equal(sameAppMapCombineCellValues({ language: "en" }, { language: "it" }), false);
});

test("Test tuple identity includes the owning App Map and preserves every Variable id", () => {
  const identity = canonicalAppMapTestTupleIdentity({
    appMapId: " map-a ",
    testId: " settings ",
    values: { z: "1", copy_label: "formal" },
  });
  assert.deepEqual(identity, {
    appMapId: "map-a",
    testId: "settings",
    values: { copy_label: "formal", z: "1" },
  });
  assert.equal(
    sameAppMapTestTupleIdentity(identity, {
      appMapId: "map-b",
      testId: "settings",
      values: { copy_label: "formal", z: "1" },
    }),
    false,
  );
  assert.deepEqual(parseAppMapTestTupleIdentity(identity), identity);
  assert.equal(
    parseAppMapTestTupleIdentity({ ...identity, values: { copy_label: { unsafe: true } } }),
    undefined,
  );
});
