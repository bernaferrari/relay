import assert from "node:assert/strict";
import test from "node:test";
import type { Recipe } from "@relay/core";
import { prepareTestRunInputs } from "./app-map-test-run-inputs.js";
import { HttpError } from "./http.js";

const recipeGraph: Record<string, Recipe> = {
  chat: {
    id: "chat",
    title: "Chat",
    source: "custom",
    createdAt: 1,
    updatedAt: 1,
    steps: [{ kind: "type", text: "{{chat_prompt}}" }],
  },
};

test("Test admission receipt retains data revision and the exact runtime value", async () => {
  const prepared = await prepareTestRunInputs({
    projectId: "project",
    recipeGraph,
    queuedAt: 42,
    variables: { chat_prompt: "Runtime prompt" },
    readProjectVariables: async () => ({ revision: 7, updatedAt: 1, value: [] }),
  });
  assert.deepEqual(prepared.variables, { chat_prompt: "Runtime prompt" });
  assert.equal(prepared.receipt?.projectDataRevision, 7);
  assert.equal(prepared.receipt?.seed, 42);
  assert.deepEqual(prepared.receipt?.values, { chat_prompt: "Runtime prompt" });
  assert.deepEqual(prepared.artifacts[0]?.data, prepared.receipt);
});

test("private prompt inputs remain available to execution and are redacted in receipts", async () => {
  const prepared = await prepareTestRunInputs({
    projectId: "project",
    recipeGraph,
    queuedAt: 42,
    variables: { chat_prompt: "Secret question" },
    readProjectVariables: async () => ({
      revision: 7,
      updatedAt: 1,
      value: [{ id: "prompt", name: "chat_prompt", scope: "private", source: "static" }],
    }),
  });
  assert.equal(prepared.variables.chat_prompt, "Secret question");
  assert.ok(!JSON.stringify(prepared.artifacts).includes("Secret question"));
  assert.deepEqual(prepared.sensitiveInputNames, ["chat_prompt"]);
});

test("unresolved prompts yield actionable offline admission failures", async () => {
  await assert.rejects(
    prepareTestRunInputs({
      projectId: "project",
      recipeGraph,
      queuedAt: 42,
      readProjectVariables: async () => ({ revision: 0, updatedAt: 1, value: [] }),
    }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 409 && error.body?.code === "missing-variable",
  );
});

test("short sensitive shared values cannot leak through frozen case names", async () => {
  const graph = structuredClone(recipeGraph);
  graph.chat!.steps = [{ kind: "type", text: "{{token}} {{public}}" }];
  const prepared = await prepareTestRunInputs({
    projectId: "project",
    recipeGraph: graph,
    queuedAt: 42,
    readProjectVariables: async () => ({
      revision: 1,
      updatedAt: 1,
      value: [
        {
          id: "secret",
          name: "token",
          scope: "shared",
          source: "static",
          values: ["abc"],
          sensitive: true,
        },
        { id: "public", name: "public", scope: "shared", source: "static", values: ["hello"] },
      ],
    }),
  });
  assert.equal(prepared.variables.token, "abc");
  assert.ok(!JSON.stringify(prepared.artifacts).includes("abc"));
});
