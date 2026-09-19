import assert from "node:assert/strict";
import test from "node:test";
import type { ModelDecisionRequest } from "@relay/protocol";
import { createOpenRouterDecisionProvider } from "./model-decision-provider.js";

function request(): ModelDecisionRequest {
  return {
    schemaVersion: 1,
    provider: "openrouter",
    model: "~typesafe/jev-latest",
    observationDigest: "sha256:observation",
    state: {
      screen: "profile",
      password: "do-not-send",
      authorization: "Bearer do-not-send",
    },
    questions: {
      route: {
        type: "choice",
        instructions: "Which review lane should handle this observation?",
        criteria: { review: "Human review", retry: "Retryable state" },
      },
      urgency: {
        type: "noul",
        instructions: "Is the current state urgent?",
      },
    },
    evidenceRefs: ["run:123"],
  };
}

function responseBody() {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "typesafe/jev-1.13",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            answers: {
              route: {
                type: "choice",
                choice: "review",
                probabilities: { review: 0.8, retry: 0.2 },
                confidence: 0.72,
              },
              urgency: { type: "noul", noul: 0.15 },
            },
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 },
  };
}

test("OpenRouter decision provider stays offline when no key is configured", async () => {
  let fetchCalls = 0;
  const provider = createOpenRouterDecisionProvider({
    apiKey: "",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("the unavailable path must not fetch");
    },
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "unavailable");
  assert.equal(result.error?.code, "provider-unavailable");
  assert.equal(result.model, "~typesafe/jev-latest");
  assert.equal(fetchCalls, 0);
});

test("OpenRouter decision provider returns validated typed answers and redacts egress", async () => {
  let sent: Record<string, unknown> | undefined;
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(responseBody()), { status: 200 });
    },
    requestId: () => "decision-1",
    now: () => 100,
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "ok");
  assert.equal(result.requestId, "decision-1");
  assert.equal(result.model, "typesafe/jev-1.13");
  assert.deepEqual(result.answers?.route, {
    type: "choice",
    choice: "review",
    probabilities: { review: 0.8, retry: 0.2 },
    confidence: 0.72,
  });
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 18 });
  assert.ok(sent);
  const serialized = JSON.stringify(sent);
  assert.equal(serialized.includes("do-not-send"), false);
  assert.equal(serialized.includes("Bearer do-not-send"), false);
  assert.equal(sent?.model as string, "~typesafe/jev-latest");
  const responseFormat = sent?.response_format as {
    json_schema: { schema: { properties: Record<string, unknown> } };
  };
  assert.ok(responseFormat.json_schema.schema.properties.answers);
});

test("OpenRouter decision provider retries only rate limits and overloads", async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    maxAttempts: 2,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ error: { message: "busy" } }), { status: 529 })
        : new Response(JSON.stringify(responseBody()), { status: 200 });
    },
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test("OpenRouter decision provider rejects incomplete or contradictory answers", async () => {
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-invalid",
          object: "chat.completion",
          created: 1,
          model: "typesafe/jev-1.13",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({ answers: { urgency: { type: "noul", noul: 2 } } }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      ),
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "invalid");
  assert.equal(result.error?.code, "invalid-response");
});

test("OpenRouter decision provider classifies a malformed successful SDK response as invalid", async () => {
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    fetch: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "invalid");
  assert.equal(result.error?.code, "invalid-response");
});
