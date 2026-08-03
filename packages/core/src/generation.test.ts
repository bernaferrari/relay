import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenRouterGenerationProvider,
  generateValues,
  registerGenerationProvider,
} from "./generation.js";

test("deterministic generation is reproducible", async () => {
  const input = {
    purpose: "variable" as const,
    prompt: "A city",
    provider: "deterministic",
    count: 3,
    seed: 42,
  };
  const first = await generateValues(input);
  const second = await generateValues(input);
  assert.deepEqual(first.values, second.values);
  assert.equal(first.values.length, 3);
  assert.equal(first.provenance?.purpose, "variable");
  assert.equal(first.provenance?.seed, 42);
  assert.match(first.provenance?.promptDigest ?? "", /^[a-f0-9]{64}$/);
  assert.ok((first.provenance?.durationMs ?? -1) >= 0);
});

test("OpenRouter generation uses structured chat output", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"values":["control-settings"]}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cost: 0.002 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const result = await createOpenRouterGenerationProvider("test-key", {
      model: "test/model",
    }).generate({
      purpose: "test-plan",
      prompt: "Choose a control",
      count: 1,
    });
    assert.deepEqual(result.values, ["control-settings"]);
    assert.equal(result.provider, "openrouter");
    assert.equal(result.model, "test/model");
    assert.deepEqual(result.usage, {
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      costUsd: 0.002,
    });
    assert.match(JSON.stringify(requestBody), /Choose a control/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("closed-vocabulary generation rejects model output outside candidate ids", async () => {
  const unregister = registerGenerationProvider({
    id: "untrusted-fixture",
    async generate() {
      return {
        provider: "untrusted-fixture",
        model: "fixture",
        values: ["delete-everything", "settings"],
        generatedAt: Date.now(),
      };
    },
  });
  try {
    const result = await generateValues({
      purpose: "test-plan",
      provider: "untrusted-fixture",
      prompt: "Untrusted app text",
      allowedValues: ["home", "settings"],
    });
    assert.deepEqual(result.values, ["settings"]);
  } finally {
    unregister();
  }
});
