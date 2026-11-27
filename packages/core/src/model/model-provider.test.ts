import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelClient,
  modelEgressBlockedReason,
  OLLAMA_BASE_URL,
  resolveRelayModelProvider,
  resolveRelayTaskModel,
  type RelayModelProvider,
} from "./model-provider.js";

const key = "sk-test-0123456789abcdef";
const saved = (provider: RelayModelProvider) => ({ version: 1 as const, provider, key });

test("explicit provider selection wins, including ollama sugar", () => {
  assert.deepEqual(
    resolveRelayModelProvider(
      { RELAY_MODEL_PROVIDER: "openai", OPENAI_API_KEY: key, ANTHROPIC_API_KEY: "other" },
      null,
    ),
    { provider: "openai", apiKey: key, baseURL: undefined, source: "explicit" },
  );
  assert.deepEqual(resolveRelayModelProvider({ RELAY_MODEL_PROVIDER: "ollama" }, null), {
    provider: "openai-compatible",
    apiKey: undefined,
    baseURL: OLLAMA_BASE_URL,
    source: "explicit",
  });
  assert.equal(
    resolveRelayModelProvider(
      { RELAY_MODEL_PROVIDER: "openai-compatible" },
      {
        provider: "openai-compatible",
        key,
        baseURL: "http://saved.local/v1",
      },
    ).baseURL,
    "http://saved.local/v1",
  );
});

test("settings are used before zero-config detection and same-provider env keys win", () => {
  assert.deepEqual(resolveRelayModelProvider({}, saved("google")), {
    provider: "google",
    apiKey: key,
    baseURL: undefined,
    source: "settings",
  });
  assert.deepEqual(
    resolveRelayModelProvider({ GOOGLE_GENERATIVE_AI_API_KEY: "env-key" }, saved("google")),
    { provider: "google", apiKey: "env-key", source: "environment" },
  );
  // Only a same-provider environment key displaces Settings; another
  // provider's key is considered later in zero-config detection.
  assert.deepEqual(resolveRelayModelProvider({ OPENAI_API_KEY: "env-key" }, saved("google")), {
    provider: "google",
    apiKey: key,
    baseURL: undefined,
    source: "settings",
  });
});

test("zero-config detection order is anthropic, openai, google, openrouter", () => {
  const env = {
    OPENROUTER_API_KEY: "or",
    GEMINI_API_KEY: "gemini",
    OPENAI_API_KEY: "openai",
    ANTHROPIC_API_KEY: "anthropic",
  };
  assert.equal(resolveRelayModelProvider(env, null).provider, "anthropic");
  assert.equal(
    resolveRelayModelProvider({ ...env, ANTHROPIC_API_KEY: "" }, null).provider,
    "openai",
  );
  assert.equal(
    resolveRelayModelProvider({ ...env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" }, null).provider,
    "google",
  );
  assert.equal(
    resolveRelayModelProvider(
      { ...env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" },
      null,
    ).provider,
    "openrouter",
  );
  assert.equal(
    resolveRelayModelProvider({ GOOGLE_GENERATIVE_AI_API_KEY: "google-key" }, null).apiKey,
    "google-key",
  );
});

test("a base URL means keyless-capable openai-compatible and otherwise none is explicit", () => {
  assert.deepEqual(
    resolveRelayModelProvider({ RELAY_MODEL_BASE_URL: "http://localhost:9999/v1" }, null),
    {
      provider: "openai-compatible",
      apiKey: undefined,
      baseURL: "http://localhost:9999/v1",
      source: "environment",
    },
  );
  assert.deepEqual(resolveRelayModelProvider({}, null), { provider: null, source: "none" });
});

test("task model overrides use neutral then legacy then generic then provider defaults", () => {
  const env = {
    RELAY_ACT_MODEL: "neutral-act",
    OPENROUTER_ACT_MODEL: "legacy-act",
    RELAY_MODEL: "neutral-generic",
    OPENROUTER_MODEL: "legacy-generic",
  };
  assert.equal(resolveRelayTaskModel("act", "anthropic", env), "neutral-act");
  assert.equal(
    resolveRelayTaskModel("act", "anthropic", { ...env, RELAY_ACT_MODEL: "" }),
    "legacy-act",
  );
  assert.equal(
    resolveRelayTaskModel("decision", "openai", {
      OPENROUTER_DECISION_MODEL: "legacy-decision",
      RELAY_MODEL: "neutral-generic",
    }),
    "legacy-decision",
  );
  assert.equal(
    resolveRelayTaskModel("act", "anthropic", { OPENROUTER_VISION_MODEL: "legacy-vision" }),
    "legacy-vision",
  );
  assert.equal(
    resolveRelayTaskModel("draft", "google", { RELAY_MODEL: "neutral-generic" }),
    "neutral-generic",
  );
  assert.equal(
    resolveRelayTaskModel("ground", "openrouter", { OPENROUTER_MODEL: "legacy-generic" }),
    "legacy-generic",
  );
});

test("provider defaults match the required vision and text matrix", () => {
  const expected = {
    anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"],
    openai: ["gpt-5.1", "gpt-5-mini"],
    google: ["gemini-flash-latest", "gemini-flash-lite-latest"],
    openrouter: ["openai/gpt-5.1", "openai/gpt-5-mini"],
  } as const;
  for (const [provider, [vision, text]] of Object.entries(expected) as Array<
    [RelayModelProvider, readonly [string, string]]
  >) {
    assert.equal(resolveRelayTaskModel("act", provider, {}), vision);
    assert.equal(resolveRelayTaskModel("check", provider, {}), vision);
    assert.equal(resolveRelayTaskModel("vision", provider, {}), vision);
    if (provider === "openrouter") {
      // Decision tasks default to the purpose-built structured decision model.
      assert.equal(resolveRelayTaskModel("decision", provider, {}), "~typesafe/jev-latest");
    } else {
      assert.equal(resolveRelayTaskModel("decision", provider, {}), text);
    }
    assert.equal(resolveRelayTaskModel("draft", provider, {}), text);
    assert.equal(resolveRelayTaskModel("ground", provider, {}), text);
    assert.equal(resolveRelayTaskModel("growth", provider, {}), text);
    assert.equal(resolveRelayTaskModel("semantic", provider, {}), text);
  }
  assert.equal(resolveRelayTaskModel("vision", "openai-compatible", {}), undefined);
  assert.equal(
    resolveRelayTaskModel("vision", "openai-compatible", { RELAY_MODEL: "llama3.2" }),
    "llama3.2",
  );
});

test("anthropic construction passes key and base URL through the provider factory seam", async () => {
  let settings: Record<string, unknown> | undefined;
  const client = await createModelClient("act", {
    env: { RELAY_MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: key },
    savedKey: null,
    providerFactories: {
      anthropic: (input) => {
        settings = input;
        return { chat: (modelId) => ({ modelId }) as never };
      },
    },
  });
  assert.equal(client.providerId, "anthropic");
  assert.equal(client.model, "claude-sonnet-5-5");
  assert.equal(settings?.apiKey, key);
  assert.equal(settings?.baseURL, "https://api.anthropic.com/v1");
  assert.deepEqual(client.provider.chat("x"), { modelId: "x" });
});

test("the real anthropic SDK is constructed lazily and sends anthropic requests", async () => {
  let url = "";
  let body: Record<string, unknown> | undefined;
  const client = await createModelClient("semantic", {
    env: { RELAY_MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: key },
    savedKey: null,
    fetch: async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const result = await client.sdk.generateText({
    model: client.provider.chat(client.model),
    prompt: "hi",
    maxRetries: 0,
  });
  assert.equal(result.text, "ok");
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(body?.model, "claude-haiku-5-5");
});

test("openai-compatible construction uses chatModel and permits keyless localhost", async () => {
  let settings: Record<string, unknown> | undefined;
  const client = await createModelClient("draft", {
    env: {
      RELAY_MODEL_PROVIDER: "ollama",
      RELAY_MODEL: "llama3.2",
    },
    savedKey: null,
    providerFactories: {
      "openai-compatible": (input) => {
        settings = input;
        return { chatModel: (modelId) => ({ modelId }) as never };
      },
    },
  });
  assert.equal(client.providerId, "openai-compatible");
  assert.equal(client.model, "llama3.2");
  assert.equal(settings?.baseURL, OLLAMA_BASE_URL);
  assert.equal(settings?.apiKey, undefined);
  assert.deepEqual(client.provider.chat("x"), { modelId: "x" });
});

test("egress allows only the active provider origin plus explicit extras", () => {
  const previous = process.env.RELAY_MODEL_EGRESS;
  delete process.env.RELAY_MODEL_EGRESS;
  try {
    assert.equal(
      modelEgressBlockedReason("https://api.anthropic.com/v1/messages", [], "anthropic"),
      undefined,
    );
    assert.match(
      modelEgressBlockedReason("https://openrouter.ai/api/v1/chat/completions", [], "anthropic") ??
        "",
      /not in the Relay egress allowlist/u,
    );
    assert.equal(
      modelEgressBlockedReason(
        "https://openrouter.ai/api/v1/chat/completions",
        ["https://openrouter.ai"],
        "anthropic",
      ),
      undefined,
    );
    assert.equal(
      modelEgressBlockedReason("http://localhost:11434/v1", [], "openai-compatible"),
      undefined,
    );
    assert.match(
      modelEgressBlockedReason("http://evil.example/v1", [], "openai-compatible") ?? "",
      /plain-HTTP|allowlist/u,
    );
    process.env.RELAY_MODEL_EGRESS = "disabled";
    assert.match(
      modelEgressBlockedReason("https://api.openai.com/v1", [], "openai") ?? "",
      /disabled/u,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_MODEL_EGRESS;
    else process.env.RELAY_MODEL_EGRESS = previous;
  }
});
