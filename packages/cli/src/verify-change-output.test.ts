import assert from "node:assert/strict";
import test from "node:test";
import type { VerifyChangeResult } from "@relay/protocol";
import { formatVerifyChangeResult } from "./verify-change-output.js";

const result: VerifyChangeResult = {
  schemaVersion: 1,
  kind: "verify-change",
  mode: "offline",
  selection: { kind: "runs" },
  summary: {
    verdict: "review",
    affectedTests: 1,
    passed: 0,
    regressions: 0,
    review: 1,
    insufficient: 0,
  },
  affectedTests: [
    {
      appMapId: "map-1",
      testId: "test-1",
      verdict: "review",
      evidenceRunIds: ["run-1"],
      executionRisk: {
        schemaVersion: 1,
        level: "guarded",
        reasons: [],
        externalEffects: ["external-app"],
        confirmation: "once-per-run",
        expectedAppBoundaries: [],
        cleanupRequired: false,
      },
    },
  ],
  evidence: [
    {
      runId: "run-1",
      tracePackDigest: `sha256:${"a".repeat(64)}`,
      status: "complete",
      historicalVerdict: "proved",
      appMapId: "map-1",
      testId: "test-1",
    },
  ],
  evidenceCompleteness: { status: "complete", complete: 1, partial: 0, missing: [] },
  policy: { id: "relay.verify-change", version: 1 },
  confidence: { value: 1, basis: "deterministic-policy" },
  decision: "ask-human",
  execution: "confirmation-required",
  ruleIds: ["execution.confirmation-required"],
  reasons: ["The frozen Test requires confirmation before device mutation."],
  evidenceRefs: [`sha256:${"a".repeat(64)}`],
  unresolvedUncertainty: [],
  smallestRequiredLiveVerification: {
    required: true,
    action: "review-and-confirm",
    reason:
      "The frozen Test declares reviewed external effects that require explicit confirmation.",
    appMapId: "map-1",
    testId: "test-1",
    evidenceNeeded: [],
  },
  mutation: "none",
  checkPosting: "none",
};

test("verify-change human output renders the bounded typed policy projection", () => {
  const output = formatVerifyChangeResult(result);

  assert.match(output ?? "", /^Verify change: review/mu);
  assert.match(output ?? "", /Affected Tests: 1 \(0 passed, 0 regressions, 1 review/u);
  assert.match(output ?? "", /Policy: relay\.verify-change@1 · ask-human/u);
  assert.match(output ?? "", /map-1\/test-1: review \(1 run\)/u);
  assert.match(output ?? "", /Smallest required live verification: review-and-confirm/u);
  assert.doesNotMatch(output ?? "", /TracePack|objects|content/u);
});

test("ordinary CLI results keep their existing formatter", () => {
  assert.equal(formatVerifyChangeResult({ kind: "other" }), undefined);
});
