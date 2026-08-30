import assert from "node:assert/strict";
import test from "node:test";
import { describeRecipeStep } from "./recipe-presentation.js";

test("reusable Test steps never expose frozen recipe identities in human reports", () => {
  const recipeId = "app-map:checkout:flow:relay-test-checkout:r12";
  assert.equal(describeRecipeStep({ kind: "module", recipeId }), "Run saved Test");
  assert.equal(describeRecipeStep({ kind: "repeat", recipeId, count: 3 }), "Repeat saved Test 3×");
});
