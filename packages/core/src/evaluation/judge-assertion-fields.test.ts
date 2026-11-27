import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INDEPENDENT_JUDGE_MODEL,
  DEFAULT_JUDGE_PROVIDER,
  compiledJudgeFields,
} from "./judge-assertion-fields.js";

test("single-judge visual assertions stay optional", () => {
  assert.deepEqual(
    compiledJudgeFields({
      kind: "visual",
      criteria: ["Composer is visible"],
    }),
    {},
  );
});

test("requireAgreement fills independent OpenRouter models", () => {
  assert.deepEqual(
    compiledJudgeFields({
      kind: "visual",
      criteria: ["Composer is visible"],
      requireAgreement: true,
    }),
    {
      requireAgreement: true,
      provider: DEFAULT_JUDGE_PROVIDER,
      secondProvider: DEFAULT_JUDGE_PROVIDER,
      secondModel: DEFAULT_INDEPENDENT_JUDGE_MODEL,
    },
  );
  assert.deepEqual(
    compiledJudgeFields({
      kind: "semantic",
      input: "reply",
      criteria: ["Names Paris"],
      requireAgreement: true,
      model: "openai/gpt-4o-mini",
      secondModel: "google/gemini-2.5-flash",
    }),
    {
      requireAgreement: true,
      provider: DEFAULT_JUDGE_PROVIDER,
      model: "openai/gpt-4o-mini",
      secondProvider: DEFAULT_JUDGE_PROVIDER,
      secondModel: "google/gemini-2.5-flash",
    },
  );
});
