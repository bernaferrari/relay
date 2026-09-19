import assert from "node:assert/strict";
import test from "node:test";
import type { ModelDecisionRequest } from "@relay/protocol";
import {
  createOpenRouterDecisionProvider,
  createOpenRouterStructuredGenerationProvider,
  OPENROUTER_DECISIONS_ENDPOINT,
} from "./model-decision-provider.js";

function request(): ModelDecisionRequest {
  return {
    schemaVersion: 1,
    provider: "openrouter",
    model: "~typesafe/jev-latest",
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

function nativeResponseBody() {
  return {
    id: "decision-abc",
    model: "typesafe/jev-1.13",
    provider: "typesafe",
    answers: {
      route: {
        type: "choice",
        choice: "review",
        probabilities: { review: 0.8, retry: 0.2 },
      },
      urgency: { type: "noul", noul: 0.15 },
    },
    usage: { input_tokens: 120, output_tokens: 18, cost: 0.0042 },
  };
}

function chatResponseBody() {
  return {
    model: "openai/gpt-4o-mini",
    choices: [
      {
        message: {
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
      },
    ],
    usage: { input_tokens: 120, output_tokens: 18 },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("native provider posts the official Decisions wire shape and redacts egress", async () => {
  let sent: Record<string, unknown> | undefined;
  let endpoint: string | undefined;
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    fetch: async (input, init) => {
      endpoint = String(input);
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, nativeResponseBody());
    },
    requestId: () => "decision-1",
    now: () => 1,
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "ok");
  assert.equal(endpoint, OPENROUTER_DECISIONS_ENDPOINT);
  assert.equal(result.model, "typesafe/jev-1.13");
  assert.equal(result.uncertaintySource, "native-distribution");
  assert.equal(result.requestId, "decision-1");
  assert.deepEqual(result.answers?.route, {
    type: "choice",
    choice: "review",
    probabilities: { review: 0.8, retry: 0.2 },
  });
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 18, costUsd: 0.0042 });
  assert.ok(sent);
  const serialized = JSON.stringify(sent);
  assert.equal(serialized.includes("do-not-send"), false);
  assert.equal(sent?.model, "~typesafe/jev-latest");
  assert.deepEqual(sent?.questions, request().questions);
  // No chat envelope in the native transport.
  assert.equal("messages" in (sent ?? {}), false);
  assert.equal("response_format" in (sent ?? {}), false);
});

test("native provider accepts an official answer without a distribution", async () => {
  const body = nativeResponseBody() as { answers: Record<string, unknown> };
  body.answers.route = { type: "choice", choice: "retry" };
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    fetch: async () => jsonResponse(200, body),
    now: () => 1,
  });
  const result = await provider.decide(request());
  assert.equal(result.status, "ok");
  assert.deepEqual(result.answers?.route, { type: "choice", choice: "retry" });
});

test("native provider rejects a choice outside the offered options", async () => {
  const body = nativeResponseBody() as { answers: Record<string, unknown> };
  body.answers.route = { type: "choice", choice: "delete-everything" };
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    fetch: async () => jsonResponse(200, body),
    now: () => 1,
  });
  const result = await provider.decide(request());
  assert.equal(result.status, "invalid");
  assert.equal(result.error?.code, "invalid-response");
  assert.equal(result.answers, undefined);
});

test("native provider retries only rate limits and overloads", async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    fetch: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse(429, { error: { message: "slow down" } }) : jsonResponse(200, nativeResponseBody());
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    now: () => 1,
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test("native provider marks a hung request unavailable on deadline", async () => {
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    timeoutMs: 5,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    now: () => 1,
  });
  const result = await provider.decide(request());
  assert.equal(result.status, "unavailable");
  assert.match(result.error?.message ?? "", /deadline/u);
});

test("native provider honors external cancellation", async () => {
  const controller = new AbortController();
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    signal: controller.signal,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    now: () => 1,
  });
  controller.abort();
  const result = await provider.decide(request());
  assert.equal(result.status, "unavailable");
  assert.match(result.error?.message ?? "", /cancel/u);
});

test("structured generation provider keeps the strict self-reported contract", async () => {
  let sent: Record<string, unknown> | undefined;
  const provider = createOpenRouterStructuredGenerationProvider({
    apiKey: "test-key",
    model: "openai/gpt-4o-mini",
    fetch: async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, chatResponseBody());
    },
    now: () => 1,
  });

  const result = await provider.decide(request());

  assert.equal(result.status, "ok");
  assert.equal(result.model, "openai/gpt-4o-mini");
  assert.equal(result.uncertaintySource, "self-reported");
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 18 });
  const responseFormat = sent?.response_format as {
    json_schema: { schema: { properties: Record<string, unknown> } };
  };
  assert.ok(responseFormat.json_schema.schema.properties.answers);
  const serialized = JSON.stringify(sent);
  assert.equal(serialized.includes("do-not-send"), false);
});

test("structured generation provider rejects contradictory self-reported distributions", async () => {
  const body = chatResponseBody();
  body.choices[0]!.message.content = JSON.stringify({
    answers: {
      route: {
        type: "choice",
        choice: "review",
        probabilities: { review: 0.3, retry: 0.2 },
        confidence: 0.72,
      },
      urgency: { type: "noul", noul: 2 },
    },
  });
  const provider = createOpenRouterStructuredGenerationProvider({
    apiKey: "test-key",
    fetch: async () => jsonResponse(200, body),
    now: () => 1,
  });
  const result = await provider.decide(request());
  assert.equal(result.status, "invalid");
  assert.equal(result.error?.code, "invalid-response");
});

test("both providers fail closed when OpenRouter is not configured", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const native = await createOpenRouterDecisionProvider().decide(request());
    assert.equal(native.status, "unavailable");
    const chat = await createOpenRouterStructuredGenerationProvider().decide(request());
    assert.equal(chat.status, "unavailable");
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
  }
});

test("egress policy blocks disallowed endpoints and disabled mode", async () => {
  const provider = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    endpoint: "https://evil.example.test/decisions",
    fetch: async () => jsonResponse(200, nativeResponseBody()),
    now: () => 1,
  });
  const blocked = await provider.decide(request());
  assert.equal(blocked.status, "unavailable");
  assert.match(blocked.error?.message ?? "", /not allowed/u);

  const allowed = createOpenRouterDecisionProvider({
    apiKey: "test-key",
    endpoint: "https://proxy.internal.test/decisions",
    allowedEndpointOrigins: ["https://proxy.internal.test"],
    fetch: async () => jsonResponse(200, nativeResponseBody()),
    now: () => 1,
  });
  const okResult = await allowed.decide(request());
  assert.equal(okResult.status, "ok");

  const previous = process.env.RELAY_MODEL_EGRESS;
  process.env.RELAY_MODEL_EGRESS = "disabled";
  try {
    const disabled = await createOpenRouterDecisionProvider({
      apiKey: "test-key",
      fetch: async () => jsonResponse(200, nativeResponseBody()),
      now: () => 1,
    }).decide(request());
    assert.equal(disabled.status, "unavailable");
    assert.match(disabled.error?.message ?? "", /disabled by policy/u);
  } finally {
    if (previous === undefined) delete process.env.RELAY_MODEL_EGRESS;
    else process.env.RELAY_MODEL_EGRESS = previous;
  }
});
