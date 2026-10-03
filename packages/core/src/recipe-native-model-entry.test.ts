import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import type { RecipeStep } from "./recipes.js";
import { nativeImaginePendingModelSelection } from "./recipe-native-model-entry.js";
const entry: Extract<RecipeStep, { kind: "expect-screen" }> = {
  id: "opened-editor",
  kind: "expect-screen",
  screenId: "editor",
  screenTitle: "Editor",
  fingerprint: "editor",
};
const source: Extract<RecipeStep, { kind: "expect-screen" }> = { ...entry, id: "model-source" };
const chosen: Extract<RecipeStep, { kind: "expect-screen" }> = {
  ...entry,
  id: "model-destination",
  fingerprint: "speed",
};
function plan(): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "grok-android",
    appMapRevision: 1,
    test: { id: "image", name: "Image", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    recipes: {
      root: {
        id: "root",
        title: "Image",
        parameters: [],
        steps: [
          { kind: "module", recipeId: "open" },
          { kind: "screenshot" },
          { kind: "module", recipeId: "model" },
        ],
      },
      open: {
        id: "open",
        title: "Open editor",
        parameters: [],
        steps: [{ kind: "tap", target: { label: "Type to imagine" } }, entry],
      },
      model: {
        id: "model",
        title: "Select model",
        parameters: [],
        steps: [source, { kind: "tap", target: { label: "Speed" } }, chosen],
      },
    },
    stepProvenance: [],
    performance: {
      executableOperations: 2,
      moduleCalls: 2,
      operationCounts: {},
      screenshotCount: 1,
      destinationProofCount: 3,
    },
    startup: { mode: "cold" },
  };
}
test("only frozen opening and model-source checkpoints may ignore remembered model defaults", () => {
  const frozen = plan();
  assert.equal(nativeImaginePendingModelSelection(frozen, entry), true);
  assert.equal(nativeImaginePendingModelSelection(frozen, source), true);
  assert.equal(nativeImaginePendingModelSelection(frozen, chosen), false);
});
test("an intervening mutation or absent/ambiguous checkpoint cannot relax model proof", () => {
  const frozen = plan();
  frozen.recipes.root!.steps.splice(2, 0, { kind: "tap", target: { label: "Another action" } });
  assert.equal(nativeImaginePendingModelSelection(frozen, entry), false);
  const duplicate = plan();
  duplicate.recipes.open!.steps.push(entry);
  assert.equal(nativeImaginePendingModelSelection(duplicate, entry), false);
  assert.equal(nativeImaginePendingModelSelection(plan(), { ...entry, id: "absent" }), false);
});
test("authored count choices and declared parameters retain the original state obligation", () => {
  const count = plan();
  count.recipes.root!.steps.unshift({ kind: "tap", target: { label: "Image count" } });
  assert.equal(nativeImaginePendingModelSelection(count, entry), false);
  const parameter = plan();
  parameter.recipes.root!.parameters.push({ name: "image_count", required: true });
  assert.equal(nativeImaginePendingModelSelection(parameter, entry), false);
});
test("generic maps and broken recursive plans never acquire native default normalization", () => {
  const generic = plan();
  generic.appMapId = "other-app";
  assert.equal(nativeImaginePendingModelSelection(generic, entry), false);
  const recursive = plan();
  recursive.recipes.open!.steps.push({ kind: "module", recipeId: "root" });
  assert.equal(nativeImaginePendingModelSelection(recursive, entry), false);
});

test("compact and spaced authored counts cannot bypass the pending-model guard", () => {
  for (const label of ["x4", "x 4", "X4", "Auto", "Image count"]) {
    const frozen = plan();
    frozen.recipes.root!.steps.unshift({
      kind: "tap",
      target: { label, identifier: "count-option" },
    });
    assert.equal(nativeImaginePendingModelSelection(frozen, entry), false, label);
  }
});

test("canonical count text selectors and named parameter labels retain count obligations", () => {
  const text = plan();
  text.recipes.root!.steps.unshift({ kind: "tap", target: { text: "x4" } });
  assert.equal(nativeImaginePendingModelSelection(text, entry), false);
  const alias = plan();
  alias.recipes.root!.parameters.push({ name: "quantity", label: "Image count" });
  assert.equal(nativeImaginePendingModelSelection(alias, entry), false);
});
