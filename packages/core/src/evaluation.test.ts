import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSemantic,
  evaluationCostUsd,
  normalizeEvaluationResult,
  registerEvaluationProvider,
} from "./evaluation.js";

describe("semantic evaluation providers", () => {
  it("does not allow a claimed pass to override missing criteria", () => {
    const result = normalizeEvaluationResult(
      { status: "pass", confidence: 1, score: 1, summary: "done", criteria: [] },
      { criteria: ["Names France"] },
      "fixture",
      "fixture-v1",
    );
    assert.equal(result.status, "uncertain");
    assert.match(result.summary, /criteria count does not match/u);
  });

  it("does not allow a claimed pass to override a failed criterion or low score", () => {
    const failedCriterion = normalizeEvaluationResult(
      {
        status: "pass",
        confidence: 1,
        score: 1,
        criteria: [{ id: "criterion-1", passed: false, score: 0, evidence: "No" }],
      },
      { criteria: ["Names France"] },
      "fixture",
      "fixture-v1",
    );
    assert.equal(failedCriterion.status, "fail");

    const lowScore = normalizeEvaluationResult(
      {
        status: "pass",
        confidence: 1,
        score: 0.4,
        criteria: [{ id: "criterion-1", passed: true, score: 1, evidence: "Yes" }],
      },
      { criteria: ["Names France"], threshold: 0.9 },
      "fixture",
      "fixture-v1",
    );
    assert.equal(lowScore.status, "fail");
  });

  it("turns nonfinite or contradictory provider answers into uncertainty", () => {
    const result = normalizeEvaluationResult(
      {
        status: "pass",
        confidence: Number.NaN,
        score: Number.POSITIVE_INFINITY,
        criteria: [{ id: "criterion-1", passed: true, score: 0 }],
      },
      { criteria: ["Names France"] },
      "fixture",
      "fixture-v1",
    );
    assert.equal(result.status, "uncertain");
    assert.match(result.summary, /invalid/u);
  });

  it("uses registered providers without coupling execution to one model vendor", async () => {
    const unregister = registerEvaluationProvider({
      id: "test-judge",
      async evaluate(input) {
        return {
          status: "pass",
          confidence: 0.98,
          score: 1,
          summary: "The answer names France.",
          criteria: input.criteria.map((description, index) => ({
            id: `criterion-${index + 1}`,
            description,
            passed: true,
            score: 1,
            evidence: "Paris is in France.",
          })),
          provider: "test-judge",
          model: "fixture",
          evaluatedAt: 1,
        };
      },
    });
    try {
      const result = await evaluateSemantic({
        input: "Paris is in France.",
        criteria: ["Identifies the correct country"],
        provider: "test-judge",
      });
      assert.equal(result.status, "pass");
      assert.equal(result.criteria[0]?.passed, true);
    } finally {
      unregister();
    }
  });

  it("reads USD cost from OpenRouter usage", () => {
    assert.equal(evaluationCostUsd({ usage: { cost: 0.0012 } }), 0.0012);
    assert.equal(evaluationCostUsd({ usage: { total_cost: 0.04 } }), 0.04);
    assert.equal(evaluationCostUsd({}), undefined);
  });

  it("never silently passes when the requested judge is not configured", async () => {
    await assert.rejects(
      () =>
        evaluateSemantic({
          input: "Paris is in France.",
          criteria: ["Names France"],
          provider: "missing-judge-provider",
        }),
      /semantic judge unavailable: provider is not configured \(missing-judge-provider\)/,
    );
  });

  it("fails closed without OPENROUTER when no provider is selected", async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    const previousProvider = process.env.RELAY_EVALUATION_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.RELAY_EVALUATION_PROVIDER;
    try {
      await assert.rejects(
        () =>
          evaluateSemantic({
            input: "Paris is in France.",
            criteria: ["Names France"],
          }),
        /semantic judge unavailable/,
      );
      await assert.rejects(
        () =>
          evaluateSemantic({
            input: "Paris is in France.",
            criteria: ["Names France"],
            provider: "openrouter",
          }),
        /semantic judge unavailable/,
      );
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous;
      if (previousProvider === undefined) delete process.env.RELAY_EVALUATION_PROVIDER;
      else process.env.RELAY_EVALUATION_PROVIDER = previousProvider;
    }
  });
});
