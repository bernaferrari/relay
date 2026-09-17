import { describe, expect, it } from "vitest";
import type { ProductRunSummary } from "@relay/product/catalog";
import type { ProductBatchReport } from "@relay/product/run-across";
import {
  attachStabilityClusterIds,
  flakyTestIdsFromStability,
  stabilityMaintenanceRecommendations,
  stabilitySamplesFromBatch,
  stabilitySamplesFromRuns,
  summarizeProductStability,
  type ProductStabilitySample,
} from "./stability-product-service";

function run(
  id: string,
  outcome: ProductRunSummary["outcome"],
  finishedAt: number,
  durationMs = 100,
  identity = true,
): ProductRunSummary {
  return {
    id,
    title: id,
    action: "run",
    status: outcome === "passed" ? "completed" : "failed",
    phase: outcome === "passed" ? "completed" : "failed",
    ...(outcome ? { outcome } : {}),
    ...(identity ? { appMapId: "app-1", testId: "test-1" } : {}),
    queuedAt: finishedAt - durationMs,
    finishedAt,
    durationMs,
    identity: { runId: id, ...(identity ? { appMapId: "app-1", testId: "test-1" } : {}) },
    links: { self: `/runs/${id}` },
  };
}

describe("stability product service", () => {
  it("projects Run execution identity onto the stability sample", () => {
    const [sample] = stabilitySamplesFromRuns([
      {
        ...run("run-id", "passed", 1_000),
        executionIdentity: {
          appMapId: "app-1",
          testId: "test-1",
          appMapRevision: 12,
          buildId: "build-92",
          targetProfileId: "chrome-admin",
          accountId: "acct-admin",
          dataSetId: "default",
        },
      },
    ]);
    expect(sample).toMatchObject({
      testRevision: 12,
      buildId: "build-92",
      targetProfileId: "chrome-admin",
      environmentId: "chrome-admin",
      accountId: "acct-admin",
      dataSetId: "default",
    });
  });

  it("reports a complete, explainable summary from identified terminal Runs", () => {
    const samples = stabilitySamplesFromRuns([
      run("run-1", "passed", 1_000, 100),
      run("run-2", "product-failure", 2_000, 110),
      run("run-3", "passed", 3_000, 120),
      run("run-4", "passed", 4_000, 130),
    ]).map((sample) => ({ ...sample, environmentId: "env-1" }));
    const summary = summarizeProductStability({
      samples,
      historyComplete: true,
      scope: { appMapId: "app-1", testId: "test-1", environmentId: "env-1" },
    });

    expect(summary).toMatchObject({
      sampleCount: 4,
      completedCount: 4,
      passedCount: 3,
      failedCount: 1,
      unknownCount: 0,
      passRate: 0.75,
      medianDurationMs: 115,
      trend: "improving",
      confidence: "complete",
    });
    expect(summary.byEnvironment).toEqual([
      expect.objectContaining({ environmentId: "env-1", passRate: 0.75, confidence: "complete" }),
    ]);
    expect(summary.byApp).toEqual([
      expect.objectContaining({ appMapId: "app-1", passRate: 0.75, confidence: "complete" }),
    ]);
    expect(summary.signals).toEqual([
      expect.objectContaining({
        kind: "mixed-outcomes",
        summary: "Different outcomes were observed. Compare these Runs.",
      }),
    ]);
    expect(summary.recommendations).toEqual([
      expect.objectContaining({
        action: "inspect-environment",
        summary: "Different outcomes were observed. Compare these Runs.",
      }),
    ]);
    expect(summary.signals.some((signal) => signal.kind === "possible-flakiness")).toBe(false);
  });

  it("calls mixed pass/fail flaky only inside a full comparable cohort", () => {
    const cohort = {
      testRevision: 12,
      buildId: "build-92",
      targetProfileId: "env-1",
      environmentId: "env-1",
      accountId: "acct-admin",
      dataSetId: "default",
      startupMode: "warm",
    };
    const summary = summarizeProductStability({
      samples: [
        {
          id: "run-1",
          runId: "run-1",
          appMapId: "app-1",
          testId: "test-1",
          outcome: "passed",
          queuedAt: 1,
          ...cohort,
        },
        {
          id: "run-2",
          runId: "run-2",
          appMapId: "app-1",
          testId: "test-1",
          outcome: "product-failure",
          queuedAt: 2,
          ...cohort,
        },
        {
          id: "run-3",
          runId: "run-3",
          appMapId: "app-1",
          testId: "test-1",
          outcome: "product-failure",
          queuedAt: 3,
          ...cohort,
          buildId: "build-93",
          targetProfileId: "env-2",
          environmentId: "env-2",
        },
      ],
      historyComplete: true,
    });
    expect(summary.signals).toEqual([
      expect.objectContaining({
        kind: "possible-flakiness",
        testId: "test-1",
        summary:
          "This Test passed and failed on the same revision, build, target, account, and starting state.",
        runIds: ["run-1", "run-2"],
      }),
    ]);
    expect(summary.recommendations[0]?.summary).toContain("same Test revision, build, target");
    expect([...flakyTestIdsFromStability(summary)]).toEqual(["test-1"]);
  });

  it("fails closed when history is partial, outcomes are non-terminal, or identity is legacy", () => {
    const samples = stabilitySamplesFromRuns([
      run("run-1", "passed", 1_000),
      run("run-2", "uncertain", 2_000),
      run("run-3", undefined, 3_000, 100, false),
    ]);
    const summary = summarizeProductStability({ samples, historyComplete: false });

    expect(summary.passRate).toBeNull();
    expect(summary.medianDurationMs).toBeNull();
    expect(summary.trend).toBe("unknown");
    expect(summary.confidence).toBe("partial");
    expect(summary.unknownCount).toBe(2);
    expect(summary.signals).toEqual([]);
  });

  it("does not call a mixed Test/environment history flaky without durable identity", () => {
    const samples: ProductStabilitySample[] = [
      {
        id: "run-1",
        runId: "run-1",
        appMapId: "app-1",
        testId: "test-1",
        environmentId: "env-1",
        outcome: "passed",
        queuedAt: 1,
      },
      {
        id: "run-2",
        runId: "run-2",
        appMapId: "app-1",
        testId: "test-1",
        outcome: "product-failure",
        queuedAt: 2,
      },
    ];
    const summary = summarizeProductStability({
      samples,
      historyComplete: true,
      scope: { environmentId: "env-1" },
    });

    expect(summary.passRate).toBeNull();
    expect(summary.confidence).toBe("partial");
    expect(summary.signals).toEqual([]);
  });

  it("keeps Batch failures unknown and refuses a rate when a case lacks identity", () => {
    const report = {
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
          status: "passed",
          values: {},
          runId: "run-1",
          identity: {
            testId: "test-1",
            environmentId: "env-1",
            environmentPlatform: "browser",
            runId: "run-1",
          },
        },
        { id: "case-2", index: 1, phase: "coverage", status: "failed", values: {} },
      ],
      setup: {
        appMapId: "app-1",
        appMapRevision: 1,
        testId: "test-1",
        testName: "Smoke",
        appName: "Checkout",
        dataSet: { name: "Default", dimensions: [] },
      },
      navigation: { route: "/batches/batch-1", href: "/batches/batch-1" },
      report: {
        headline: "1 case needs attention",
        detail: "1 passed · 1 failed",
        executionLine: "1 passed, 1 check failed",
        checksLine: "1 passed, 1 check failed",
        coverageLine: "1 of 2 planned cases verified",
      },
    } as unknown as ProductBatchReport;

    const summary = summarizeProductStability({
      samples: stabilitySamplesFromBatch(report),
      historyComplete: true,
      scope: { testId: "test-1" },
    });
    expect(summary.passRate).toBeNull();
    expect(summary.unknownCount).toBe(1);
    expect(summary.byEnvironment[0]).toMatchObject({
      environmentId: "env-1",
      passRate: 1,
    });
    expect(summary.owners).toEqual([]);
  });

  it("projects Batch triage assignees as ownership without inventing owners", () => {
    const report = {
      id: "batch-owned",
      title: "Languages",
      status: "completed-with-problems",
      createdAt: 1,
      updatedAt: 2,
      totalCases: 2,
      completedCases: 2,
      passedCases: 0,
      failedCases: 2,
      pendingCases: 0,
      targetNames: [],
      runIds: ["run-en", "run-pt"],
      cases: [
        {
          id: "cell-en",
          index: 0,
          phase: "coverage",
          status: "failed",
          values: {},
          runId: "run-en",
          assignee: "human:qa",
          identity: {
            testId: "test-1",
            environmentId: "pixel",
            environmentPlatform: "android",
            runId: "run-en",
          },
        },
        {
          id: "cell-pt",
          index: 1,
          phase: "coverage",
          status: "failed",
          values: {},
          runId: "run-pt",
          identity: {
            testId: "test-1",
            environmentId: "pixel",
            environmentPlatform: "android",
            runId: "run-pt",
          },
        },
      ],
      setup: {
        appMapId: "app-1",
        appMapRevision: 1,
        testId: "test-1",
        testName: "Languages",
        appName: "Grok",
        dataSet: { name: "Languages", dimensions: [] },
      },
      navigation: { route: "/batches/batch-owned", href: "/batches/batch-owned" },
      report: {
        headline: "2 cases need attention",
        detail: "0 passed · 2 failed",
        executionLine: "0 passed, 2 check failed",
        checksLine: "0 passed, 2 check failed",
        coverageLine: "0 of 2 planned cases verified",
      },
    } as unknown as ProductBatchReport;

    const samples = stabilitySamplesFromBatch(report);
    expect(samples[0]?.assignee).toBe("human:qa");
    expect(samples[1]?.assignee).toBeUndefined();
    const summary = summarizeProductStability({ samples, historyComplete: true });
    expect(summary.owners).toEqual([{ assignee: "human:qa", caseCount: 1, problemCount: 1 }]);
    expect(summary.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "open-ownership",
          summary: "1 assigned case has a review owner.",
        }),
      ]),
    );
    expect(summary.recommendations).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "review-owned" })]),
    );
  });

  it("groups Apps and attached failure clusters without inventing cluster identity", () => {
    const samples: ProductStabilitySample[] = [
      {
        id: "cell-a",
        runId: "run-a",
        appMapId: "app-a",
        testId: "test-1",
        environmentId: "env-1",
        outcome: "product-failure",
        status: "failed",
      },
      {
        id: "cell-b",
        runId: "run-b",
        appMapId: "app-b",
        testId: "test-2",
        environmentId: "env-1",
        outcome: "passed",
        status: "passed",
      },
    ];
    const joined = attachStabilityClusterIds(samples, [
      { id: "cluster-visual", caseIds: ["cell-a"] },
    ]);
    expect(joined[0]?.clusterId).toBe("cluster-visual");
    expect(joined[1]?.clusterId).toBeUndefined();
    const summary = summarizeProductStability({ samples: joined, historyComplete: true });
    expect(summary.byApp.map((bucket) => [bucket.appMapId, bucket.passed, bucket.failed])).toEqual([
      ["app-a", 0, 1],
      ["app-b", 1, 0],
    ]);
    expect(summary.byCluster).toEqual([
      expect.objectContaining({ clusterId: "cluster-visual", total: 1, failed: 1, passed: 0 }),
    ]);
    expect(summary.byCluster).toHaveLength(1);
  });

  it("maps duration regression onto an inspect-duration recommendation", () => {
    const recommendations = stabilityMaintenanceRecommendations([
      {
        kind: "duration-regression",
        severity: "warning",
        summary: "Median duration increased from 100ms to 200ms.",
        runIds: ["run-1", "run-2"],
      },
    ]);
    expect(recommendations).toEqual([
      {
        id: "inspect-duration",
        action: "inspect-duration",
        summary: "Investigate the duration increase before the next release.",
        runIds: ["run-1", "run-2"],
      },
    ]);
  });
});
