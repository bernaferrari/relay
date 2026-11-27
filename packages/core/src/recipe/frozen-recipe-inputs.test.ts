import assert from "node:assert/strict";
import test from "node:test";
import {
  freezeRecipeInputs,
  frozenRecipeInputsMatch,
  parseFrozenRecipeInputReceipt,
} from "./frozen-recipe-inputs.js";
import type { Recipe } from "./recipes.js";

const recipeGraph: Record<string, Recipe> = {
  chat: {
    id: "chat",
    title: "Chat",
    source: "custom",
    createdAt: 1,
    updatedAt: 1,
    steps: [{ kind: "type", text: "{{prompt}}" }],
  },
};

test("frozen inputs retain generated provenance, revision and exact values without changing the graph", async () => {
  const before = JSON.stringify(recipeGraph);
  const prepared = await freezeRecipeInputs({
    recipeGraph,
    definitions: {
      revision: 7,
      value: [
        {
          id: "prompt-data",
          name: "prompt",
          scope: "shared",
          source: "generated",
          prompt: "Ask about geography",
        },
      ],
    },
    seed: 42,
  });
  assert.ok(prepared);
  assert.equal(JSON.stringify(recipeGraph), before);
  assert.equal(prepared.receipt.projectDataRevision, 7);
  assert.equal(prepared.receipt.seed, 42);
  assert.equal(prepared.receipt.case?.provenance[0]?.seed, 42);
  assert.equal(prepared.receipt.case?.provenance[0]?.source, "generated");
  assert.deepEqual(parseFrozenRecipeInputReceipt(prepared.receipt), prepared.receipt);
  assert.equal(
    frozenRecipeInputsMatch(prepared.receipt, {
      ...prepared.variables,
      wrapper: "extra",
      extracted: "later",
    }),
    true,
  );
  assert.equal(frozenRecipeInputsMatch(prepared.receipt, { prompt: "changed" }), false);
  assert.equal(
    parseFrozenRecipeInputReceipt({ ...prepared.receipt, values: { prompt: "changed" } }),
    undefined,
  );
  assert.equal(parseFrozenRecipeInputReceipt({ ...prepared.receipt, extra: true }), undefined);
});

test("short sensitive values remain execution-local, including generated case names and aliases", async () => {
  const graph = structuredClone(recipeGraph);
  graph.chat!.steps = [{ kind: "type", text: "{{prompt}} {{prompt-data}}" }];
  const prepared = await freezeRecipeInputs({
    recipeGraph: graph,
    definitions: {
      revision: 1,
      value: [
        {
          id: "prompt-data",
          name: "prompt",
          scope: "shared",
          source: "static",
          values: ["abc"],
          sensitive: true,
        },
      ],
    },
    seed: 1,
  });
  assert.ok(prepared);
  assert.equal(prepared.variables.prompt, "abc");
  assert.equal(JSON.stringify(prepared.receipt).includes("abc"), false);
  assert.deepEqual(prepared.receipt.values, { prompt: "[private]", "prompt-data": "[private]" });
  assert.deepEqual(parseFrozenRecipeInputReceipt(prepared.receipt), prepared.receipt);
  assert.equal(frozenRecipeInputsMatch(prepared.receipt, prepared.variables), true);
  assert.equal(frozenRecipeInputsMatch(prepared.receipt, prepared.receipt.values), false);
  assert.equal(
    frozenRecipeInputsMatch(prepared.receipt, { prompt: "xyz", "prompt-data": "xyz" }),
    false,
  );
});
