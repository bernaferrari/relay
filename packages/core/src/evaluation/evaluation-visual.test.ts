import assert from "node:assert/strict";
import test from "node:test";
import { evaluateVisual } from "./evaluation-visual.js";

const image = { mimeType: "image/png" as const, data: "AA==" };

test("visual judge fails closed without OPENROUTER_API_KEY", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  const previousProvider = process.env.RELAY_EVALUATION_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.RELAY_EVALUATION_PROVIDER;
  try {
    await assert.rejects(
      () => evaluateVisual({ criteria: ["Composer is empty"], image }),
      /visual judge unavailable: OPENROUTER_API_KEY is not configured/u,
    );
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
    if (previousProvider === undefined) delete process.env.RELAY_EVALUATION_PROVIDER;
    else process.env.RELAY_EVALUATION_PROVIDER = previousProvider;
  }
});

test("visual judge never silently passes an unknown provider", async () => {
  await assert.rejects(
    () =>
      evaluateVisual({
        criteria: ["Composer is empty"],
        image,
        provider: "missing-visual-judge",
      }),
    /visual judge unavailable: provider is not configured \(missing-visual-judge\)/u,
  );
});

test("visual judge uses the Vercel AI SDK OpenRouter boundary", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: "chatcmpl-visual-test",
        model: "test/vision",
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                status: "pass",
                confidence: 0.95,
                score: 1,
                summary: "The composer is empty.",
                criteria: [{ id: "criterion-1", passed: true, score: 1 }],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, cost: 0.002 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const result = await evaluateVisual({
      criteria: ["Composer is empty"],
      image,
      model: "test/vision",
    });
    assert.equal(result.status, "pass");
    assert.equal(result.provider, "openrouter");
    assert.equal(result.model, "test/vision");
    assert.equal(result.costUsd, 0.002);
    assert.match(JSON.stringify(requestBody), /AA==/u);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
