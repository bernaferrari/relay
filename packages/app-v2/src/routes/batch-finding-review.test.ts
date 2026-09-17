import { describe, expect, it } from "vitest";
import type { CombineEvidenceAnalysisReport, CombineEvidenceFinding } from "@relay/protocol";
import type { ProductBatchReport } from "@relay/product/run-across";
import {
  findingScreenshotRunId,
  latestFindingDecision,
  planFindingsAnalysisState,
  resolvePlanFindings,
} from "./batch-finding-review";
import { planFindingTestId } from "@relay/protocol";

const finding = (
  partial: Partial<CombineEvidenceFinding> & Pick<CombineEvidenceFinding, "id" | "canonicalKey">,
): CombineEvidenceFinding => ({
  code: "HARNESS_FAILURE",
  severity: "critical",
  confidence: "high",
  screenLabel: "Toolbar",
  locale: "logged-out",
  baselineLocale: "logged-out",
  detail: "SOS",
  ...partial,
});

const report = (cases: CombineEvidenceAnalysisReport["cases"]): CombineEvidenceAnalysisReport => ({
  schemaVersion: 1,
  batchId: "batch-1",
  locales: ["logged-out"],
  analysis: {
    schemaVersion: 1,
    sessionId: "s1",
    generatedAt: 1,
    baselineLocale: "logged-out",
    findings: [],
    critical: 0,
    warnings: 0,
    affectedScreens: 0,
  },
  coverage: { frames: 0, inspectedFrames: 0 },
  cases,
});

describe("findingScreenshotRunId", () => {
  it("uses the job: canonical key", () => {
    expect(
      findingScreenshotRunId(
        finding({
          id: "harness-failure-099e8094-8018-4d44-b00b-73d2290b2f3f",
          canonicalKey: "job:099e8094-8018-4d44-b00b-73d2290b2f3f",
        }),
        report([]),
      ),
    ).toBe("099e8094-8018-4d44-b00b-73d2290b2f3f");
  });

  it("falls back to a case job id inside the finding id", () => {
    expect(
      findingScreenshotRunId(
        finding({ id: "harness-failure-job-home", canonicalKey: "toolbar" }),
        report([{ jobId: "job-home", locale: "en", status: "cancelled", frames: [] }]),
      ),
    ).toBe("job-home");
  });

  it("reads the latest Confirm/Reject note without treating it as a baseline accept", () => {
    expect(
      latestFindingDecision(
        [
          {
            caseId: "finding:harness-1",
            text: "confirm: Confirmed as a product issue. This does not accept a new visual baseline.",
            at: 1,
            actorId: "human:qa",
          },
          {
            caseId: "finding:harness-1",
            text: "reject: Rejected as not a product failure this run. This does not accept a new visual baseline.",
            at: 2,
            actorId: "human:qa",
          },
        ],
        "harness-1",
      ),
    ).toBe("reject");
  });
});

function batchReport(id = "batch-1"): ProductBatchReport {
  return {
    id,
    title: "Languages",
    status: "completed-with-problems",
    createdAt: 1,
    updatedAt: 2,
    totalCases: 2,
    completedCases: 2,
    passedCases: 0,
    failedCases: 2,
    pendingCases: 0,
    targetNames: ["Selected environment"],
    runIds: ["job-a", "job-b"],
    cases: [
      {
        id: "case-a",
        index: 0,
        phase: "coverage",
        status: "failed",
        values: {},
        runId: "job-a",
        findingCode: "PRODUCT_ASSERTION",
        error: "provisional A",
        identity: { testId: "login", environmentId: "env-a", environmentPlatform: "browser" },
      },
      {
        id: "case-b",
        index: 1,
        phase: "coverage",
        status: "failed",
        values: {},
        runId: "job-b",
        findingCode: "HARNESS_FAILURE",
        error: "provisional B",
        identity: { testId: "toolbar", environmentId: "env-b", environmentPlatform: "browser" },
      },
    ],
    setup: {
      appMapId: "app-1",
      appMapRevision: 1,
      testId: "login",
      testName: "Login",
      appName: "Grok",
      dataSet: { name: "Default", dimensions: [] },
    },
    navigation: { route: "/batches/batch-1", href: "/batches/batch-1" },
    report: {
      headline: "Incomplete",
      detail: "2 failed",
      executionLine: "2 failed",
      checksLine: "2 failed",
      coverageLine: "0 of 2 planned cases verified",
    },
  };
}

describe("resolvePlanFindings", () => {
  it("treats missing analysis as pending and keeps typed cells", () => {
    const batch = batchReport();
    expect(planFindingsAnalysisState(batch)).toBe("pending");
    const resolved = resolvePlanFindings(batch);
    expect(resolved.analysis.findings.map((item) => item.canonicalKey)).toEqual([
      "job:job-a",
      "job:job-b",
    ]);
  });

  it("rejects analysis from another batch and keeps derived cells", () => {
    const batch = batchReport();
    const analysis = report([]);
    analysis.batchId = "other-batch";
    analysis.analysis.findings = [
      finding({
        id: "only-a",
        canonicalKey: "job:job-a",
        code: "PRODUCT_ASSERTION",
        detail: "rich A",
      }),
    ];
    expect(planFindingsAnalysisState(batch, analysis)).toBe("failed");
    const resolved = resolvePlanFindings(batch, analysis);
    expect(resolved.analysis.findings.map((item) => item.detail)).toEqual([
      "provisional A",
      "provisional B",
    ]);
  });

  it("replaces A with richer analysis and does not drop B", () => {
    const batch = batchReport();
    const analysis = report([{ jobId: "job-a", locale: "en", status: "failed", frames: [] }]);
    analysis.analysis.findings = [
      finding({
        id: "rich-a",
        canonicalKey: "job:job-a",
        code: "PRODUCT_ASSERTION",
        detail: "richer A",
        screenLabel: "Login",
      }),
    ];
    const resolved = resolvePlanFindings(batch, analysis);
    expect(resolved.analysis.findings.map((item) => [item.canonicalKey, item.detail])).toEqual([
      ["job:job-a", "richer A"],
      ["job:job-b", "provisional B"],
    ]);
  });

  it("keeps two analyzed findings from the same job", () => {
    const batch = batchReport();
    const analysis = report([{ jobId: "job-a", locale: "en", status: "failed", frames: [] }]);
    analysis.analysis.findings = [
      finding({
        id: "check-seats",
        canonicalKey: "job:job-a",
        code: "PRODUCT_ASSERTION",
        detail: "seats",
      }),
      finding({
        id: "check-save",
        canonicalKey: "job:job-a",
        code: "PRODUCT_ASSERTION",
        detail: "save",
      }),
    ];
    const resolved = resolvePlanFindings(batch, analysis);
    expect(resolved.analysis.findings.map((item) => item.id)).toEqual([
      "check-seats",
      "check-save",
      "cell-case-b",
    ]);
  });

  it("keeps a complete analysis with no findings when cells have no codes", () => {
    const source = batchReport();
    const batch = {
      ...source,
      cases: source.cases.map((item) => ({
        ...item,
        findingCode: undefined,
        status: "passed" as const,
      })),
    };
    const analysis = report([]);
    analysis.analysis.findings = [];
    expect(planFindingsAnalysisState(batch, analysis)).toBe("complete");
    expect(resolvePlanFindings(batch, analysis).analysis.findings).toEqual([]);
  });

  it("copies durable Test identity from the Result cell onto analyzed findings", () => {
    const batch = batchReport();
    const analysis = report([{ jobId: "job-a", locale: "en", status: "failed", frames: [] }]);
    analysis.analysis.findings = [
      finding({
        id: "rich-a",
        canonicalKey: "job:job-a",
        code: "PRODUCT_ASSERTION",
        detail: "richer A",
        screenLabel: "Login chrome",
      }),
    ];
    const resolved = resolvePlanFindings(batch, analysis);
    expect(resolved.analysis.findings.map((item) => [item.id, item.testId])).toEqual([
      ["rich-a", "login"],
      ["cell-case-b", "toolbar"],
    ]);
  });

  it("does not invent a Test id from a similar screen label", () => {
    const source = batchReport();
    const batch = {
      ...source,
      cases: source.cases.map((item) => ({ ...item, identity: undefined })),
    };
    const resolved = resolvePlanFindings(batch);
    expect(resolved.analysis.findings.every((item) => item.testId === undefined)).toBe(true);
    expect(planFindingTestId(resolved.analysis.findings[0]!)).toBeUndefined();
  });
});
