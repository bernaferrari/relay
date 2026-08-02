import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRouterGenerationProvider, generateValues } from "./generation.js";

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
});

test("OpenRouter generation uses structured chat output", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"values":["control-settings"]}' } }] }),
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
    assert.match(JSON.stringify(requestBody), /Choose a control/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
