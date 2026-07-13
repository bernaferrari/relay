import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRunOutcome } from "./outcomes.js";

describe("classifyRunOutcome", () => {
  it("separates product assertions from harness failures", () => {
    assert.deepEqual(
      classifyRunOutcome({ status: "error", error: "semantic assertion: wrong country" }),
      { outcome: "product-failure", failureCategory: "semantic-assertion" },
    );
    assert.deepEqual(
      classifyRunOutcome({ status: "error", error: "tap failed: no strategy matched" }),
      { outcome: "harness-failure", failureCategory: "locator" },
    );
  });

  it("preserves uncertainty and cancellation as distinct outcomes", () => {
    assert.deepEqual(
      classifyRunOutcome({ status: "error", error: "judge uncertain: insufficient evidence" }),
      { outcome: "uncertain", failureCategory: "judge-uncertainty" },
    );
    assert.deepEqual(classifyRunOutcome({ status: "cancelled", errorCode: "CANCELLED" }), {
      outcome: "cancelled",
    });
  });
});
