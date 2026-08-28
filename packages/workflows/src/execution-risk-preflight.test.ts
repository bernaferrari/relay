import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionRisk } from "@relay/protocol";
import { executionRiskPreflightProblem } from "./execution-risk-preflight.js";

function risk(
  confirmation: ExecutionRisk["confirmation"],
  level: ExecutionRisk["level"] = "guarded",
): ExecutionRisk {
  return {
    schemaVersion: 1,
    level,
    reasons: [{ code: "fixture", explanation: "Reviewed fixture effect." }],
    externalEffects: confirmation === "none" ? [] : ["external-app"],
    confirmation,
    expectedAppBoundaries: [],
    cleanupRequired: false,
  };
}

test("safe risk remains frictionless and once-per-run consent is exact", () => {
  assert.equal(executionRiskPreflightProblem(risk("none", "safe"), undefined), undefined);
  assert.equal(executionRiskPreflightProblem(risk("once-per-run"), true), undefined);
  assert.equal(
    executionRiskPreflightProblem(risk("once-per-run"), undefined)?.code,
    "risk-confirmation-required",
  );
});

test("one outcome confirmation never collapses per-step, human-only, or prohibited policy", () => {
  assert.equal(
    executionRiskPreflightProblem(risk("per-step"), true)?.code,
    "risk-confirmation-required",
  );
  assert.equal(
    executionRiskPreflightProblem(risk("human-only", "destructive"), true)?.retryable,
    false,
  );
  assert.equal(
    executionRiskPreflightProblem(risk("human-only", "prohibited"), true)?.code,
    "compile-blocked",
  );
});
