import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApprovalPolicyInput } from "@relay/protocol";
import { evaluateApprovalPolicy } from "./approval-policy.js";

function input(overrides: Partial<ApprovalPolicyInput> = {}): ApprovalPolicyInput {
  return {
    schemaVersion: 1,
    policy: { id: "protected-release", version: 3 },
    executionRisk: {
      schemaVersion: 1,
      level: "safe",
      reasons: [],
      externalEffects: [],
      confirmation: "none",
      expectedAppBoundaries: ["com.example.app"],
      cleanupRequired: false,
    },
    confirmationSatisfied: false,
    evidence: {
      status: "complete",
      requiredChannels: ["input", "screenshot"],
      missing: [],
      tracePackDigest: `sha256:${"a".repeat(64)}`,
    },
    verification: {
      requiredPaths: "passed",
      selectorResolution: "deterministic",
      unresolved: [],
    },
    findings: [],
    ...overrides,
  };
}

describe("evaluateApprovalPolicy", () => {
  it("approves only complete deterministic proof", () => {
    const decision = evaluateApprovalPolicy(input());
    assert.equal(decision.execution, "allowed");
    assert.equal(decision.decision, "approve");
    assert.deepEqual(decision.ruleIds, ["verification.proved"]);
    assert.deepEqual(decision.confidence, { value: 1, basis: "deterministic-policy" });
  });

  it("never converts missing evidence into a pass", () => {
    const decision = evaluateApprovalPolicy(
      input({
        evidence: {
          status: "partial",
          requiredChannels: ["input", "screenshot"],
          missing: ["screenshot"],
        },
      }),
    );
    assert.equal(decision.decision, "insufficient-evidence");
    assert.equal(decision.confidence, undefined);
    assert.ok(decision.unresolvedVerification.includes("missing:screenshot"));
  });

  it("rejects a proved crash and cites its evidence", () => {
    const decision = evaluateApprovalPolicy(
      input({
        findings: [
          {
            id: "crash-1",
            category: "crash",
            severity: "regression",
            summary: "The app crashed after Save.",
            evidenceRefs: [`sha256:${"b".repeat(64)}`],
          },
        ],
      }),
    );
    assert.equal(decision.decision, "reject");
    assert.deepEqual(decision.ruleIds, ["finding.crash"]);
    assert.equal(decision.confidence?.value, 1);
    assert.equal(decision.evidenceRefs.length, 2);
  });

  it("does not let partial evidence mask a proved definitive failure", () => {
    const decision = evaluateApprovalPolicy(
      input({
        evidence: {
          status: "partial",
          requiredChannels: ["input", "screenshot", "logs"],
          missing: ["screenshot"],
          tracePackDigest: `sha256:${"a".repeat(64)}`,
        },
        verification: {
          requiredPaths: "failed",
          selectorResolution: "unproven",
          unresolved: ["selector-needs-live-verification"],
        },
        findings: [
          {
            id: "crash-1",
            category: "crash",
            severity: "regression",
            summary: "The app crashed after Save.",
            evidenceRefs: [`sha256:${"b".repeat(64)}`],
          },
        ],
      }),
    );

    assert.equal(decision.decision, "reject");
    assert.deepEqual(decision.ruleIds, ["verification.required-path-lost", "finding.crash"]);
    assert.deepEqual(decision.confidence, { value: 1, basis: "deterministic-policy" });
  });

  it("asks a person before guarded or human-only execution", () => {
    const guarded = input();
    guarded.executionRisk = {
      ...guarded.executionRisk,
      level: "guarded",
      confirmation: "once-per-run",
      externalEffects: ["communication"],
    };
    const decision = evaluateApprovalPolicy(guarded);
    assert.equal(decision.execution, "confirmation-required");
    assert.equal(decision.decision, "ask-human");
    assert.deepEqual(decision.ruleIds, ["execution.confirmation-required"]);
  });

  it("blocks prohibited execution before considering optimistic findings", () => {
    const prohibited = input();
    prohibited.executionRisk = {
      ...prohibited.executionRisk,
      level: "prohibited",
      confirmation: "human-only",
      reasons: [{ code: "purchase", explanation: "Purchases are outside fixture policy." }],
      externalEffects: ["purchase"],
    };
    const decision = evaluateApprovalPolicy(prohibited);
    assert.equal(decision.execution, "blocked");
    assert.equal(decision.decision, "reject");
    assert.deepEqual(decision.ruleIds, ["execution.prohibited"]);
  });

  it("requires review for visual changes unless the exact finding was reviewed", () => {
    const visualFinding = {
      id: "visual-1",
      category: "visual" as const,
      severity: "regression" as const,
      summary: "The approved surface changed.",
      evidenceRefs: [],
    };
    assert.equal(
      evaluateApprovalPolicy(input({ findings: [visualFinding] })).decision,
      "ask-human",
    );
    assert.equal(
      evaluateApprovalPolicy(input({ findings: [{ ...visualFinding, reviewed: true }] })).decision,
      "approve",
    );
  });
});
