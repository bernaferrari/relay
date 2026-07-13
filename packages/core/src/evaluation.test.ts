import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateSemantic, registerEvaluationProvider } from "./evaluation.js";

describe("semantic evaluation providers", () => {
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
});
