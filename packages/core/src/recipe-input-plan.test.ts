import assert from "node:assert/strict";
import test from "node:test";
import type { TestData } from "@relay/protocol";
import { prepareFrozenRecipeInputs } from "./recipe-input-plan.js";
import { resolveRecipeStep } from "./recipe-runner-support.js";
import type { Recipe } from "./recipes.js";

function graph(text: string): Record<string, Recipe> {
  return {
    chat: {
      id: "chat",
      title: "Chat",
      source: "custom",
      createdAt: 1,
      updatedAt: 1,
      steps: [{ kind: "type", text }],
    },
  };
}
const prompt: TestData = {
  id: "prompt-data",
  name: "chat_prompt",
  scope: "shared",
  source: "list",
  values: ["First question", "Second question"],
};

test("a single saved Test freezes one referenced default and runtime overrides", async () => {
  const recipeGraph = graph("{{chat_prompt}} / {{prompt-data}}");
  const defaults = await prepareFrozenRecipeInputs({
    recipeGraph,
    definitions: [prompt],
    seed: 42,
  });
  assert.deepEqual(defaults.variables, {
    chat_prompt: "First question",
    "prompt-data": "First question",
  });
  assert.equal(defaults.matrix?.cases.length, 1);
  const override = await prepareFrozenRecipeInputs({
    recipeGraph,
    definitions: [prompt],
    runtimeValues: { "prompt-data": "Third question", unused: "ignore" },
    seed: 42,
  });
  assert.deepEqual(override.variables, {
    chat_prompt: "Third question",
    "prompt-data": "Third question",
  });
  assert.deepEqual(resolveRecipeStep(recipeGraph.chat!.steps[0]!, override.variables), {
    kind: "type",
    text: "Third question / Third question",
  });
  prompt.values![0] = "Changed after admission";
  assert.equal(defaults.variables.chat_prompt, "First question");
});

test("missing external and private inputs block before execution", async () => {
  await assert.rejects(
    prepareFrozenRecipeInputs({ recipeGraph: graph("{{missing}}"), definitions: [] }),
    /has no value/,
  );
  await assert.rejects(
    prepareFrozenRecipeInputs({
      recipeGraph: graph("{{token}}"),
      definitions: [{ id: "private", name: "token", scope: "private", source: "static" }],
    }),
    /needs a local value/,
  );
  const privateValues = await prepareFrozenRecipeInputs({
    recipeGraph: graph("{{token}} {{private}}"),
    definitions: [{ id: "private", name: "token", scope: "private", source: "static" }],
    runtimeValues: { token: "secret-value" },
  });
  assert.deepEqual(privateValues.sensitiveInputNames, ["private", "token"]);
});

test("unused generated Data sets never affect the Test; referenced generation freezes provenance", async () => {
  const generated: TestData = {
    id: "generated",
    name: "chat_prompt",
    scope: "shared",
    source: "generated",
    prompt: "Ask about geography",
  };
  const noInputs = await prepareFrozenRecipeInputs({
    recipeGraph: graph("literal"),
    definitions: [generated],
    seed: 42,
  });
  assert.deepEqual(noInputs.variables, {});
  assert.equal(noInputs.matrix, undefined);
  const first = await prepareFrozenRecipeInputs({
    recipeGraph: graph("{{chat_prompt}}"),
    definitions: [generated],
    seed: 42,
  });
  const second = await prepareFrozenRecipeInputs({
    recipeGraph: graph("{{chat_prompt}}"),
    definitions: [generated],
    seed: 42,
  });
  assert.deepEqual(first.variables, second.variables);
  assert.equal(first.matrix?.cases[0]?.provenance[0]?.seed, 42);
});

test("reusable local parameters keep their lexical bindings", async () => {
  const recipeGraph = graph("{{local}} {{root_input}}");
  recipeGraph.chat!.parameters = [{ name: "local", required: true }];
  const prepared = await prepareFrozenRecipeInputs({
    recipeGraph,
    definitions: [],
    runtimeValues: { root_input: "outer" },
  });
  assert.deepEqual(prepared.variables, { root_input: "outer" });
});

test("prior extracted outputs and bound reusable parameters do not demand project input values", async () => {
  const recipeGraph = graph("{{response}} {{local}}");
  recipeGraph.chat!.steps.unshift({ kind: "extract", as: "response", target: { label: "Answer" } });
  recipeGraph.chat!.parameters = [{ name: "local", required: true }];
  const definitions: TestData[] = [
    {
      id: "response-data",
      name: "response",
      scope: "shared",
      source: "generated",
      prompt: "Never generate an observed response",
    },
    { id: "local-data", name: "local", scope: "private", source: "static" },
  ];
  const prepared = await prepareFrozenRecipeInputs({ recipeGraph, definitions });
  assert.deepEqual(prepared.variables, {});
  assert.equal(prepared.matrix, undefined);
});

test("caller outputs remain available inside reusable recipes and after their return", async () => {
  const recipeGraph = graph("{{reply}}");
  recipeGraph.child = {
    ...recipeGraph.chat!,
    id: "child",
    steps: [
      { kind: "type", text: "{{reply}} {{bound}}" },
      { kind: "extract", as: "result", target: { label: "Result" } },
    ],
    parameters: [{ name: "bound", required: true }],
  };
  recipeGraph.chat!.steps = [
    { kind: "extract", as: "reply", target: { label: "Answer" } },
    { kind: "module", recipeId: "child", bindings: { bound: "literal" } },
    { kind: "type", text: "{{result}}" },
  ];
  assert.deepEqual(
    (await prepareFrozenRecipeInputs({ recipeGraph, definitions: [] })).variables,
    {},
  );
});

test("an output produced on only one branch cannot satisfy a later action", async () => {
  const recipeGraph = graph("{{reply}}");
  recipeGraph.then = {
    ...recipeGraph.chat!,
    id: "then",
    steps: [{ kind: "extract", as: "reply", target: { label: "Answer" } }],
  };
  recipeGraph.chat!.steps.unshift({
    kind: "branch",
    input: "mode",
    operator: "exists",
    thenRecipeId: "then",
  });
  await assert.rejects(
    prepareFrozenRecipeInputs({ recipeGraph, definitions: [] }),
    /Input “reply” has no value/,
  );
});

test("plain branch inputs forward supplied or default values and remain optional when absent", async () => {
  const recipeGraph = graph("literal");
  recipeGraph.chat!.steps = [
    { kind: "branch", input: "model", operator: "equals", expected: "Fast", thenRecipeId: "then" },
  ];
  recipeGraph.then = { ...recipeGraph.chat!, id: "then", steps: [] };
  assert.deepEqual(
    (
      await prepareFrozenRecipeInputs({
        recipeGraph,
        definitions: [],
        runtimeValues: { model: "Fast" },
      })
    ).variables,
    { model: "Fast" },
  );
  assert.deepEqual(
    (
      await prepareFrozenRecipeInputs({
        recipeGraph,
        definitions: [
          { id: "mode", name: "model", scope: "shared", source: "static", values: ["Expert"] },
        ],
      })
    ).variables,
    { model: "Expert" },
  );
  assert.deepEqual(
    (
      await prepareFrozenRecipeInputs({
        recipeGraph,
        definitions: [{ id: "mode", name: "model", scope: "private", source: "static" }],
      })
    ).variables,
    {},
  );
});

test("plain assertion and semantic inputs require external values but extracted outputs remain local", async () => {
  const recipeGraph = graph("literal");
  recipeGraph.chat!.steps = [
    { kind: "assert-content", input: "answer", expected: "Fast", match: "exact" },
    { kind: "evaluate-semantic", input: "answer", criteria: ["is helpful"] },
  ];
  await assert.rejects(
    prepareFrozenRecipeInputs({ recipeGraph, definitions: [] }),
    /Input “answer” has no value/,
  );
  assert.deepEqual(
    (
      await prepareFrozenRecipeInputs({
        recipeGraph,
        definitions: [],
        runtimeValues: { answer: "Fast" },
      })
    ).variables,
    { answer: "Fast" },
  );
  recipeGraph.chat!.steps.unshift({ kind: "extract", as: "answer", target: { label: "Response" } });
  assert.deepEqual(
    (await prepareFrozenRecipeInputs({ recipeGraph, definitions: [] })).variables,
    {},
  );
});
