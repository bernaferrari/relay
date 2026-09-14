import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRunOutcome } from "./outcomes.js";

describe("classifyRunOutcome", () => {
  it("keeps unacknowledged mutations uncertain instead of declaring a product failure", () => {
    for (const error of [
      "Input outcome unknown: tap failed: connection reset",
      "The iOS press may already have reached the device. Relay did not retry it.",
    ]) {
      assert.deepEqual(classifyRunOutcome({ status: "error", error }), {
        outcome: "uncertain",
        failureCategory: "action",
      });
    }
  });
  it("separates product assertions from harness failures", () => {
    assert.deepEqual(
      classifyRunOutcome({ status: "error", error: "semantic assertion: wrong country" }),
      { outcome: "product-failure", failureCategory: "semantic-assertion" },
    );
    assert.deepEqual(
      classifyRunOutcome({ status: "error", error: "tap failed: no strategy matched" }),
      { outcome: "harness-failure", failureCategory: "locator" },
    );
    assert.deepEqual(
      classifyRunOutcome({ status: "error", error: "expect-screen: reached a different screen" }),
      { outcome: "product-failure", failureCategory: "deterministic-assertion" },
    );
    assert.deepEqual(
      classifyRunOutcome({
        status: "error",
        error:
          "layout assertion: identifier description overlaps identifier primary-action by 240×22 px",
      }),
      { outcome: "product-failure", failureCategory: "deterministic-assertion" },
    );
  });

  it("keeps infrastructure causal when lower layers also report assertion text", () => {
    assert.deepEqual(
      classifyRunOutcome({
        status: "error",
        error: "expect-screen: assertion failed because device session connection was lost",
      }),
      { outcome: "harness-failure", failureCategory: "environment" },
    );
    assert.deepEqual(
      classifyRunOutcome({
        status: "error",
        error: "semantic assertion: target could not be evaluated",
        errorCode: "INTERNAL",
      }),
      { outcome: "harness-failure", failureCategory: "harness-defect" },
    );
  });

  it("preserves uncertainty and cancellation as distinct outcomes", () => {
    assert.deepEqual(
      classifyRunOutcome({ status: "error", error: "judge uncertain: insufficient evidence" }),
      { outcome: "uncertain", failureCategory: "judge-uncertainty" },
    );
    assert.deepEqual(
      classifyRunOutcome({
        status: "error",
        error: "visual judge unavailable: OPENROUTER_API_KEY is not configured",
      }),
      { outcome: "harness-failure", failureCategory: "environment" },
    );
    assert.deepEqual(
      classifyRunOutcome({
        status: "error",
        error:
          "judge uncertain: Primary judge unavailable: visual judge unavailable: OPENROUTER_API_KEY is not configured",
      }),
      { outcome: "harness-failure", failureCategory: "environment" },
    );
    assert.deepEqual(classifyRunOutcome({ status: "cancelled", errorCode: "CANCELLED" }), {
      outcome: "cancelled",
    });
  });

  it("treats a deferred capability as reviewable instead of green", () => {
    assert.deepEqual(
      classifyRunOutcome({
        status: "ok",
        review: {
          schemaVersion: 1,
          status: "pending",
          capability: "camera attachment",
          reason: "This workstation cannot inspect the captured image yet.",
          requestedAt: 1,
        },
      }),
      { outcome: "uncertain", failureCategory: "review-required" },
    );
  });
});
