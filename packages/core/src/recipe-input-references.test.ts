import assert from "node:assert/strict";
import test from "node:test";
import type { TestData } from "@relay/protocol";
import { CasePlanError } from "./case-plan.js";
import { freezeRecipeInputs } from "./frozen-recipe-inputs.js";
import { resolveRecipeInputReferences } from "./recipe-input-references.js";
import { resolveRecipeStep } from "./recipe-runner-support.js";
import type { Recipe } from "./recipes.js";

const graph: Record<string, Recipe> = {
  prompt: {
    id: "prompt",
    title: "Prompt",
    source: "custom",
    createdAt: 1,
    updatedAt: 1,
    steps: [{ kind: "type", text: "{{chat_prompt}}" }],
  },
};
const definition: TestData = {
  id: "prompt-data",
  name: "chat_prompt",
  scope: "shared",
  source: "list",
  values: ["Explain why ocean tides change", "Suggest a paper airplane tip"],
};

test("an input-only selected row binds its Project Data set ID despite unrelated display names", async () => {
  const receipts = [];
  for (const valueId of definition.values!) {
    const resolved = resolveRecipeInputReferences({
      recipeGraph: graph,
      definitions: [definition],
      selectedRows: [
        {
          id: "questions",
          name: "Questions",
          inputId: "prompt-data",
          valueId: "row",
          value: valueId,
        },
      ],
    });
    const frozen = await freezeRecipeInputs({
      recipeGraph: graph,
      definitions: { revision: 7, value: [definition] },
      runtimeValues: resolved.runtimeValues,
      seed: 42,
    });
    assert.ok(frozen);
    assert.deepEqual(resolveRecipeStep(graph.prompt!.steps[0]!, frozen.variables), {
      kind: "type",
      text: valueId,
    });
    receipts.push(frozen.receipt);
  }
  assert.notEqual(receipts[0]!.valuesDigest, receipts[1]!.valuesDigest);
});

test("public list/static rows freeze exact multiline text and reject changed whitespace approval", async () => {
  const value = "  First line\nSecond line.\n ";
  for (const source of ["list", "static"] as const) {
    const exact = { ...definition, source, values: [value] };
    const row = { id: "questions", inputId: exact.id, valueId: "value-1", value };
    const resolved = resolveRecipeInputReferences({
      recipeGraph: graph,
      definitions: [exact],
      selectedRows: [row],
    });
    assert.equal(resolved.runtimeValues.chat_prompt, value);
    const frozen = await freezeRecipeInputs({
      recipeGraph: graph,
      definitions: { revision: 8, value: [exact] },
      runtimeValues: resolved.runtimeValues,
      seed: 42,
    });
    assert.ok(frozen);
    assert.deepEqual(resolveRecipeStep(graph.prompt!.steps[0]!, frozen.variables), {
      kind: "type",
      text: value,
    });
    assert.equal(frozen.receipt.values.chat_prompt, value);
    assert.throws(
      () =>
        resolveRecipeInputReferences({
          recipeGraph: graph,
          definitions: [{ ...exact, values: [value.trim()] }],
          selectedRows: [row],
        }),
      /approved Project input values/,
    );
  }
});

test("legacy public literal rows preserve whitespace and distinguish equally trimmed prompts", async () => {
  const value = "  First\nSecond  ";
  for (const source of ["list", "static"] as const) {
    const exact = { ...definition, source, values: [value, value.trim()] };
    for (const selected of [value, value.trim()]) {
      const resolved = resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [exact],
        selectedRows: [{ id: exact.id, name: exact.name, valueId: selected }],
      });
      const frozen = await freezeRecipeInputs({
        recipeGraph: graph,
        definitions: { revision: 8, value: [exact] },
        runtimeValues: resolved.runtimeValues,
        seed: 42,
      });
      assert.equal(frozen?.variables.chat_prompt, selected);
    }
    assert.throws(
      () =>
        resolveRecipeInputReferences({
          recipeGraph: graph,
          definitions: [{ ...exact, values: [value.trim()] }],
          selectedRows: [{ id: exact.id, valueId: value }],
        }),
      /approved Test input value/,
    );
  }
});

test("explicit input rows validate approved public definitions and skip only inapplicable cells", () => {
  const row = {
    id: "questions",
    inputId: "prompt-data",
    valueId: "second",
    value: definition.values![1]!,
  };
  for (const invalid of [
    [],
    [definition, definition],
    [{ ...definition, scope: "private" as const }],
    [{ ...definition, source: "generated" as const }],
    [{ ...definition, sensitive: true }],
    [definition, { ...definition, id: "other", name: "prompt-data" }],
  ]) {
    assert.throws(
      () =>
        resolveRecipeInputReferences({
          recipeGraph: graph,
          definitions: invalid,
          selectedRows: [row],
        }),
      (error: unknown) => error instanceof CasePlanError && error.code === "conflicting-variable",
    );
  }
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [definition],
        selectedRows: [{ ...row, value: "Unknown prompt" }],
      }),
    /approved Project input values/,
  );
  const unused = { ...definition, id: "image-data", name: "image_prompt", values: ["Draw a fox"] };
  assert.deepEqual(
    resolveRecipeInputReferences({
      recipeGraph: graph,
      definitions: [definition, unused],
      selectedRows: [
        row,
        { id: "pictures", inputId: "image-data", valueId: "fox", value: "Draw a fox" },
      ],
    }).runtimeValues,
    { chat_prompt: definition.values![1] },
  );
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [definition],
        selectedRows: [row],
        runtimeValues: { chat_prompt: definition.values![0]! },
      }),
    /Selected row and supplied value disagree/,
  );
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [{ ...definition, source: "static" }],
        selectedRows: [row],
      }),
    /approved Project input values/,
  );
});

test("selected approved row IDs resolve actual distinct prompts without changing the graph", async () => {
  const before = JSON.stringify(graph);
  const receipts = [];
  for (const valueId of definition.values!) {
    const resolved = resolveRecipeInputReferences({
      recipeGraph: graph,
      definitions: [definition],
      selectedRows: [{ id: "prompt-data", name: "Questions", valueId }],
    });
    const frozen = await freezeRecipeInputs({
      recipeGraph: graph,
      definitions: { revision: 7, value: [definition] },
      runtimeValues: resolved.runtimeValues,
      seed: 42,
    });
    assert.ok(frozen);
    assert.deepEqual(resolveRecipeStep(graph.prompt!.steps[0]!, frozen.variables), {
      kind: "type",
      text: valueId,
    });
    receipts.push(frozen.receipt);
  }
  assert.notEqual(receipts[0]!.valuesDigest, receipts[1]!.valuesDigest);
  assert.equal(JSON.stringify(graph), before);
  assert.equal(receipts[0]!.case?.provenance[0]?.source, "list");
});

test("dimension names may bind explicitly, but selector row IDs never infer text payloads", () => {
  assert.deepEqual(
    resolveRecipeInputReferences({
      recipeGraph: graph,
      definitions: [definition],
      selectedRows: [{ id: "questions", name: "chat_prompt", valueId: definition.values![1]! }],
    }).runtimeValues,
    { chat_prompt: definition.values![1] },
  );
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [definition],
        selectedRows: [{ id: "prompt-data", valueId: "row-2" }],
      }),
    /not an approved Test input value/,
  );
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [],
        selectedRows: [{ id: "chat_prompt", valueId: "Opaque row" }],
      }),
    /no unambiguous Project input binding/,
  );
});

test("selected aliases and explicit overrides cannot collapse different worlds", () => {
  const selectedRows = [{ id: "prompt-data", valueId: definition.values![0]! }];
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [definition],
        selectedRows,
        runtimeValues: { chat_prompt: definition.values![1]! },
      }),
    /Selected row and supplied value disagree/,
  );
  assert.deepEqual(
    resolveRecipeInputReferences({
      recipeGraph: graph,
      definitions: [definition],
      selectedRows,
      runtimeValues: { "prompt-data": definition.values![0]! },
    }).runtimeValues,
    { chat_prompt: definition.values![0] },
  );
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [definition],
        selectedRows: [...selectedRows, { id: "chat_prompt", valueId: definition.values![1]! }],
      }),
    /Selected row and supplied value disagree/,
  );
  assert.throws(
    () =>
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [definition, { ...definition, id: "other", name: "questions" }],
        selectedRows: [{ id: "prompt-data", name: "questions", valueId: definition.values![0]! }],
      }),
    /no unambiguous Project input binding/,
  );
});

test("local parameters and outputs ignore selected rows; unrelated rows leave defaults and generation alone", () => {
  const local = structuredClone(graph);
  local.prompt!.parameters = [{ name: "chat_prompt", required: true }];
  assert.deepEqual(
    resolveRecipeInputReferences({
      recipeGraph: local,
      definitions: [definition],
      selectedRows: [{ id: "prompt-data", valueId: "row-2" }],
    }).runtimeValues,
    {},
  );
  for (const source of ["list", "generated"] as const) {
    assert.deepEqual(
      resolveRecipeInputReferences({
        recipeGraph: graph,
        definitions: [{ ...definition, source }],
        selectedRows: [{ id: "language", valueId: "fr" }],
      }).runtimeValues,
      {},
    );
  }
});

test("persisted rows cannot supply private inputs or replace generated values", async () => {
  const privateDefinition = { ...definition, scope: "private" as const };
  const privateValues = resolveRecipeInputReferences({
    recipeGraph: graph,
    definitions: [privateDefinition],
    selectedRows: [{ id: "prompt-data", valueId: definition.values![0]! }],
  }).runtimeValues;
  assert.deepEqual(privateValues, {});
  await assert.rejects(
    freezeRecipeInputs({
      recipeGraph: graph,
      definitions: { revision: 7, value: [privateDefinition] },
      runtimeValues: privateValues,
      seed: 42,
    }),
    /needs a local value/,
  );
  assert.deepEqual(
    resolveRecipeInputReferences({
      recipeGraph: graph,
      definitions: [{ ...definition, source: "generated", prompt: "Generate a question" }],
      selectedRows: [{ id: "prompt-data", valueId: definition.values![0]! }],
    }).runtimeValues,
    {},
  );
});
