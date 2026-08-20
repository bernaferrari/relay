import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalAppMapCombineCellValues,
  compareUtf8Bytewise,
  sameAppMapCombineCellValues,
} from "./app-map-combine-cell.js";

test("Combine cell identity sorts variable ids bytewise", () => {
  assert.equal(compareUtf8Bytewise("a-b", "a_b") < 0, true);
  assert.deepEqual(Object.keys(canonicalAppMapCombineCellValues({ z: "1", a: "2" })), ["a", "z"]);
  assert.equal(
    sameAppMapCombineCellValues({ language: "en", theme: "dark" }, { theme: "dark", language: "en" }),
    true,
  );
  assert.equal(
    sameAppMapCombineCellValues({ language: "en" }, { language: "it" }),
    false,
  );
});
