import { describe, expect, it } from "vitest";
import {
  composeProductIssue,
  createIntegrationsProductService,
} from "./integration-product-service";

describe("integration and issue handoff product service", () => {
  it("reports only provable workspace/provider capability state", async () => {
    const service = createIntegrationsProductService({
      platform: "web",
      getServerUrl: () => "http://127.0.0.1:8787",
      storage: { get: () => null, set: () => {} },
    });
    const integrations = await service.list();
    expect(integrations.find(({ provider }) => provider === "relay")).toMatchObject({
      state: "connected",
      capabilities: ["workspace"],
    });
    expect(integrations.some(({ provider }) => provider === "github")).toBe(false);
    expect(integrations.find(({ provider }) => provider === "slack")).toMatchObject({
      state: "unsupported",
    });
    expect(JSON.stringify(integrations)).not.toMatch(/token|secret|credential/iu);
  });

  it("composes a redacted run handoff and never creates a delivery payload", () => {
    const draft = composeProductIssue({
      kind: "run",
      report: {
        runId: "run-1",
        title: "Checkout failed",
        outcome: "product-failure",
        cause: "password=super-secret at https://example.test/path?token=private",
        category: "assertion",
        firstEvidence: { label: "Error screenshot" },
        timeline: [{ id: "step-1", index: 0, title: "Submit", state: "failed", evidenceCount: 1 }],
        evidence: [
          {
            id: "screenshot",
            label: "Screenshot",
            count: 1,
            detail: "Captured",
            summary: "One frame",
            inspectable: true,
            items: [],
          },
        ],
      },
    });
    expect(draft).toMatchObject({
      source: { kind: "run", id: "run-1" },
      delivery: { state: "draft-only", supportedMutation: false },
      redaction: { applied: true },
    });
    expect(draft.body).not.toContain("super-secret");
    expect(draft.body).not.toContain("token=private");
    expect(draft.body).toContain("[redacted]");
  });

  it("supports Batch and change handoff sources without exposing raw evidence", () => {
    const batch = composeProductIssue({
      kind: "batch",
      report: {
        id: "batch-1",
        title: "Smoke matrix",
        status: "completed-with-problems",
        createdAt: 1,
        updatedAt: 2,
        totalCases: 2,
        completedCases: 2,
        passedCases: 1,
        failedCases: 1,
        pendingCases: 0,
        targetNames: ["Chrome"],
        runIds: ["run-1"],
        cases: [
          {
            id: "case-1",
            index: 0,
            phase: "coverage",
            status: "failed",
            values: {},
            error: "assertion failed",
          },
        ],
        navigation: { route: "/batches/batch-1", href: "/batches/batch-1" },
        report: {
          headline: "1 case needs attention",
          detail: "1 passed · 1 failed",
          executionLine: "1 passed, 1 check failed",
          checksLine: "1 passed, 1 check failed",
          coverageLine: "1 of 2 planned cases verified",
        },
      },
    });
    const change = composeProductIssue({
      kind: "change",
      details: {
        change: {
          id: "change-1",
          version: 1,
          status: "needs-review",
          repository: "acme/app",
          title: "Change verification",
          baseRevision: "a".repeat(40),
          requestedRevision: "b".repeat(40),
          runs: ["run-1"],
          evidenceCount: 1,
          coverageGaps: [],
          residualRisk: [],
          affectedTestCount: 1,
          requiredVerificationCount: 1,
          advisoryVerificationCount: 0,
          updatedAt: 2,
        },
        history: [],
        publications: [],
        affectedTests: [],
        verificationPlan: [],
        planApproved: false,
        audit: {
          policy: "default@1",
          policyId: "default",
          policyVersion: 1,
          requestedBy: "human:test",
          updatedBy: "human:test",
          buildIds: [],
          proofVersion: 1,
        },
      },
    });
    expect(batch.source).toEqual({ kind: "batch", id: "batch-1" });
    expect(change.source).toEqual({ kind: "change", id: "change-1" });
    expect(batch.body).not.toMatch(/rootDir|jobIds/iu);
  });
});
