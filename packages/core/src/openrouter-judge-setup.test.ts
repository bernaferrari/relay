import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectOpenRouterJudgeSetup,
  OPENROUTER_JUDGE_NOT_CONFIGURED,
} from "./openrouter-judge-setup.js";

test("a missing OpenRouter key stays needs-attention and never echoes a secret", () => {
  const status = inspectOpenRouterJudgeSetup({});
  assert.equal(status.status, "needs-attention");
  assert.equal(status.configured, false);
  assert.equal(status.detail, OPENROUTER_JUDGE_NOT_CONFIGURED);
  assert.equal(inspectOpenRouterJudgeSetup({ OPENROUTER_API_KEY: "   " }).configured, false);
});

test("a present OpenRouter key is ready without returning the key", () => {
  const status = inspectOpenRouterJudgeSetup({ OPENROUTER_API_KEY: "sk-or-v1-test" });
  assert.equal(status.status, "ready");
  assert.equal(status.configured, true);
  assert.match(status.detail, /OpenRouter key found/u);
  assert.doesNotMatch(status.detail, /sk-or-v1-test/u);
});
