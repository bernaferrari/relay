import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectModelJudgeSetup,
  inspectOpenRouterJudgeSetup,
  MODEL_JUDGE_NOT_CONFIGURED,
} from "./openrouter-judge-setup.js";

const key = "sk-test-0123456789abcdef";

test("a missing model provider stays needs-attention and never echoes a secret", () => {
  const status = inspectModelJudgeSetup({}, null);
  assert.equal(status.status, "needs-attention");
  assert.equal(status.configured, false);
  assert.equal(status.detail, MODEL_JUDGE_NOT_CONFIGURED);
  assert.equal(inspectModelJudgeSetup({ OPENROUTER_API_KEY: "   " }, null).configured, false);
});

test("every zero-config provider key is ready without returning the key", () => {
  for (const env of [
    { ANTHROPIC_API_KEY: key },
    { OPENAI_API_KEY: key },
    { GEMINI_API_KEY: key },
    { GOOGLE_GENERATIVE_AI_API_KEY: key },
    { OPENROUTER_API_KEY: key },
  ]) {
    const status = inspectModelJudgeSetup(env, null);
    assert.equal(status.status, "ready");
    assert.equal(status.configured, true);
    assert.match(status.detail, /Model provider found/u);
    assert.doesNotMatch(status.detail, new RegExp(key, "u"));
  }
});

test("settings keys and keyless compatible endpoints count as configured", () => {
  const settings = inspectModelJudgeSetup(
    {},
    {
      version: 1,
      provider: "anthropic",
      key,
    },
  );
  assert.equal(settings.status, "ready");
  assert.equal(settings.provider, "anthropic");
  const compatible = inspectModelJudgeSetup(
    { RELAY_MODEL_BASE_URL: "http://localhost:11434/v1" },
    null,
  );
  assert.equal(compatible.status, "ready");
  assert.equal(compatible.provider, "openai-compatible");
});

test("the legacy probe name now reports the active provider", () => {
  const status = inspectOpenRouterJudgeSetup({ ANTHROPIC_API_KEY: key });
  assert.equal(status.status, "ready");
  assert.equal(status.provider, "anthropic");
});
