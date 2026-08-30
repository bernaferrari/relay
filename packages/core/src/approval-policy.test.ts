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
            runId: "run-crash-1",
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
            runId: "run-crash-1",
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

  it("requires provenance-bound review for visual changes", () => {
    const visualFinding = {
      id: "visual-1",
      runId: "run-visual-1",
      category: "visual" as const,
      severity: "regression" as const,
      summary: "The approved surface changed.",
      evidenceRefs: ["sha256:visual-evidence"],
    };
    const currentEvidence = {
      ...input().evidence,
      runIds: [visualFinding.runId],
      evidenceRefs: visualFinding.evidenceRefs,
    };
    assert.equal(
      evaluateApprovalPolicy(input({ findings: [visualFinding] })).decision,
      "ask-human",
    );
    assert.equal(
      evaluateApprovalPolicy(
        input({
          evidence: currentEvidence,
          findings: [
            {
              ...visualFinding,
              review: {
                schemaVersion: 1,
                decisionId: "decision-visual-1",
                reviewedBy: "human:reviewer",
                reviewedAt: 10,
                reason: "Inspected the exact changed surface.",
                scope: {
                  findingId: visualFinding.id,
                  runId: visualFinding.runId,
                  evidenceRefs: visualFinding.evidenceRefs,
                },
              },
            },
          ],
        }),
      ).decision,
      "approve",
    );
  });

  it("fails closed for forged, stale, or legacy finding review authority", () => {
    const finding = {
      id: "selector-1",
      runId: "run-current",
      category: "selector" as const,
      severity: "review" as const,
      summary: "The selector needs review.",
      evidenceRefs: ["sha256:selector-evidence"],
    };
    const evidence = {
      ...input().evidence,
      runIds: [finding.runId],
      evidenceRefs: finding.evidenceRefs,
    };
    const validReview = {
      schemaVersion: 1 as const,
      decisionId: "decision-selector-1",
      reviewedBy: "human:reviewer",
      reviewedAt: 10,
      reason: "Inspected the exact selector evidence.",
      scope: {
        findingId: finding.id,
        runId: finding.runId,
        evidenceRefs: finding.evidenceRefs,
      },
    };

    for (const review of [
      { ...validReview, scope: { ...validReview.scope, findingId: "other-finding" } },
      { ...validReview, scope: { ...validReview.scope, runId: "run-stale" } },
      {
        ...validReview,
        scope: { ...validReview.scope, evidenceRefs: ["sha256:stale-evidence"] },
      },
      {
        ...validReview,
        scope: { ...validReview.scope, evidenceRefs: undefined as never },
      },
      { ...validReview, reviewedAt: -1 },
    ]) {
      assert.equal(
        evaluateApprovalPolicy(input({ evidence, findings: [{ ...finding, review }] })).decision,
        "ask-human",
      );
    }

    assert.equal(
      evaluateApprovalPolicy(
        input({
          evidence: { ...evidence, runIds: ["run-stale"] },
          findings: [{ ...finding, review: validReview }],
        }),
      ).decision,
      "ask-human",
    );
    assert.equal(
      evaluateApprovalPolicy(
        input({
          evidence: {
            ...evidence,
            evidenceRefs: [...finding.evidenceRefs, "sha256:new-evidence"],
          },
          findings: [{ ...finding, review: validReview }],
        }),
      ).decision,
      "approve",
      "unrelated current Proof evidence must not broaden or revoke a finding-scoped review",
    );
    assert.equal(
      evaluateApprovalPolicy(
        input({
          evidence: { ...evidence, evidenceRefs: [] },
          findings: [{ ...finding, review: validReview }],
        }),
      ).decision,
      "ask-human",
      "reviewed evidence that is no longer current must fail closed",
    );
    assert.equal(
      evaluateApprovalPolicy(
        input({
          evidence: {
            ...evidence,
            runIds: [finding.runId, "run-other"],
            evidenceRefs: [...finding.evidenceRefs, "sha256:other-evidence"],
          },
          findings: [
            { ...finding, review: validReview },
            {
              id: "visual-other",
              runId: "run-other",
              category: "visual",
              severity: "review",
              summary: "Another surface still needs review.",
              evidenceRefs: ["sha256:other-evidence"],
            },
          ],
        }),
      ).decision,
      "ask-human",
      "reviewing one finding must not authorize another finding",
    );

    assert.equal(
      evaluateApprovalPolicy(
        input({
          evidence,
          findings: [{ ...finding, review: true as never }],
        }),
      ).decision,
      "ask-human",
    );
  });
});
