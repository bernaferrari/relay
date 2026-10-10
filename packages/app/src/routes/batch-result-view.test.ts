import { describe, expect, it } from "vitest";
import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchReport,
} from "@relay/product/run-across";
import {
  batchClusterCopy,
  batchClusterGroupCount,
  batchResultContext,
  batchResultFacts,
  batchResultHeadline,
  formatBatchCaseError,
  formatBatchColumnLabel,
  formatBatchEnvironmentLabel,
  formatBatchFindingCode,
  formatBatchTestLabel,
} from "./batch-result-view";

function cluster(
  input: Partial<ProductBatchFailureCluster> & Pick<ProductBatchFailureCluster, "id">,
): ProductBatchFailureCluster {
  return {
    kind: "causal",
    signature: {
      kind: "causal",
      digest: `sha256:${"a".repeat(64)}`,
      summary: "causal failure",
      checkIds: [],
    },
    environmentId: "browser:grok-com-1280x800-339a5a430a41",
    representativeCaseId: "case-1",
    representativeRunId: "run-1",
    caseIds: ["case-1", "case-2"],
    ...input,
  };
}

function report(cases: ProductBatchCase[]): ProductBatchReport {
  return {
    id: "batch-1",
    title: "Languages",
    status: "completed-with-problems",
    createdAt: 1,
    updatedAt: 2,
    totalCases: cases.length,
    completedCases: cases.length,
    passedCases: cases.filter((item) => item.status === "passed").length,
    failedCases: cases.filter((item) => item.status === "failed").length,
    pendingCases: 0,
    targetNames: ["Selected environment"],
    runIds: [],
    cases,
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
      headline: "Incomplete — 31 of 33 planned cases verified",
      detail: "31 passed",
      executionLine: "31 passed",
      checksLine: "31 passed",
      coverageLine: "31 of 33 planned cases verified",
    },
  };
}

describe("Batch result presentation", () => {
  it("drops duplicate Execution/Checks/Coverage copy for an incomplete Result", () => {
    const cases: ProductBatchCase[] = [
      ...Array.from({ length: 31 }, (_, index) => ({
        id: `ok-${index}`,
        index,
        phase: "coverage" as const,
        status: "passed" as const,
        values: {},
      })),
      {
        id: "fail-1",
        index: 31,
        phase: "coverage",
        status: "failed",
        values: {},
        outcome: "product-failure",
      },
      {
        id: "fail-2",
        index: 32,
        phase: "coverage",
        status: "failed",
        values: {},
        outcome: "product-failure",
      },
    ];
    const batch = report(cases);
    expect(batchResultHeadline(batch)).toBe("2 product issues to review");
    expect(batchResultFacts(batch)).toEqual([
      { label: "Passed", value: 31 },
      { label: "Product issues", value: 2, tone: "critical" },
    ]);
    expect(batchResultContext(batch)).toBe("Login · Default");
  });

  it("names saved sessions and strips profile uuid dumps", () => {
    expect(formatBatchEnvironmentLabel("browser:grok-com-1280x800-339a5a430a41")).toBe("Grok com");
    expect(formatBatchEnvironmentLabel("browser:grok-lab")).toBe("grok-lab");
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-daily-b")).toBe("grok-daily-b");
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-daily-c")).toBe("grok-daily-c");
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-daily-d")).toBe("grok-daily-d");
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-daily-e")).toBe("grok-daily-e");
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-daily-h")).toBe("grok-daily-h");
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-daily")).toBe("grok-daily");
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-auth-email")).toBe(
      "grok-auth-email",
    );
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-auth-gmail")).toBe(
      "grok-auth-gmail",
    );
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-auth-x-out")).toBe(
      "grok-auth-x-out",
    );
    expect(formatBatchEnvironmentLabel("grok-com#signed-out:grok-auth-x")).toBe("grok-auth-x");
    expect(
      formatBatchEnvironmentLabel("pixel-profile", {
        environmentLabel: "Pixel 8",
        targetLabel: "Pixel 8",
      }),
    ).toBe("Pixel 8");
    expect(
      formatBatchEnvironmentLabel("browser:grok-com", {
        environmentLabel: "Browser grok com 1280×800 339a5a430a41",
      }),
    ).toBe("grok-com");
  });

  it("titles a cluster as a Findings group, not engine jargon", () => {
    expect(batchClusterGroupCount(1)).toBe("1 group");
    expect(batchClusterGroupCount(2)).toBe("2 groups");
    expect(batchClusterCopy(cluster({ id: "c1" }))).toEqual({
      lane: "Product",
      title: "Product behavior",
      meta: "2 cases · Grok com",
    });
    expect(
      batchClusterCopy(
        cluster({
          id: "c2",
          kind: "visual",
          signature: {
            kind: "visual",
            digest: `sha256:${"b".repeat(64)}`,
            summary: "visual failure in check-9",
            failureCategory: "visual-assertion",
            checkIds: ["check-9"],
          },
        }),
      ),
    ).toEqual({
      lane: "Needs review",
      title: "Visual difference",
      meta: "2 cases · Grok com",
    });
  });

  it("names Result columns with Sign-in and Lane, not fixture or authoring ids", () => {
    expect(
      formatBatchColumnLabel({
        environmentId: "browser:grok-com",
        environmentLabel: "f47ac10b-58cc-4372-a567-0e02b2c3d479 · grok-com",
        accountLabel: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        targetLabel: "Grok.com",
      }),
    ).toBe("Grok.com");
    expect(
      formatBatchColumnLabel({
        environmentId: "browser:grok-com",
        environmentLabel: "Member A · Grok.com",
        accountLabel: "Member A",
        targetLabel: "Grok.com",
      }),
    ).toBe("Member A · Grok.com");
    expect(formatBatchTestLabel("test-authoring-1a2bc3ea12ff", "Test authoring 1a2bc3ea12ff")).toBe(
      "Test",
    );
    expect(formatBatchTestLabel("login", "Open home")).toBe("Open home");
    expect(formatBatchTestLabel("test-signed-in-toolbar-existing")).toBe(
      "Signed in toolbar existing",
    );
    expect(formatBatchFindingCode("HARNESS_FAILURE")).toBe("Harness");
    expect(formatBatchFindingCode("PRODUCT_ASSERTION")).toBe("Product check");
    expect(formatBatchFindingCode("JUDGE_UNCERTAIN")).toBe("Judge");
    expect(formatBatchCaseError("causal failure in step-8be8bb50")).toBe("This check failed");
    expect(formatBatchCaseError("Timeout waiting for check-12")).toBe("Timeout waiting for");
  });

  it("uses a case Lane label when the cluster only has a profile id", () => {
    const copy = batchClusterCopy(cluster({ id: "c3", environmentId: "pixel-profile" }), [
      {
        id: "case-1",
        index: 0,
        phase: "coverage",
        status: "failed",
        values: {},
        identity: {
          testId: "login",
          environmentId: "pixel-profile",
          environmentPlatform: "android",
          environmentLabel: "acct-a · grok-com",
        },
      },
    ]);
    expect(copy.meta).toBe("2 cases · acct-a · grok-com");
  });

  it("keeps viewport, locale, and account in Result columns", () => {
    expect(
      formatBatchColumnLabel({
        environmentId: "browser:firefox-390x844-abcdef1234",
        environmentLabel: "Member · Firefox · 390 × 844",
        accountLabel: "Member",
        targetLabel: "Firefox",
        locale: "ar",
      }),
    ).toBe("Member · Firefox · 390 × 844 · Arabic");
  });

  it("does not label a product crash Infra just because the group kind is crash", () => {
    expect(
      batchClusterCopy(
        cluster({
          id: "crash-product",
          kind: "crash",
          signature: {
            kind: "crash",
            digest: `sha256:${"c".repeat(64)}`,
            summary: "crash failure",
            checkIds: [],
          },
        }),
        [
          {
            id: "case-1",
            index: 0,
            phase: "coverage",
            status: "failed",
            values: {},
            findingCode: "PRODUCT_ASSERTION",
            outcome: "product-failure",
          },
        ],
      ).lane,
    ).toBe("Product");
  });

  it("keeps mixed product and harness members Mixed", () => {
    expect(
      batchClusterCopy(cluster({ id: "mixed" }), [
        {
          id: "case-1",
          index: 0,
          phase: "coverage",
          status: "failed",
          values: {},
          findingCode: "PRODUCT_ASSERTION",
        },
        {
          id: "case-2",
          index: 1,
          phase: "coverage",
          status: "failed",
          values: {},
          findingCode: "HARNESS_FAILURE",
        },
      ]).lane,
    ).toBe("Mixed");
  });

  it("keeps expired fixture, cancellation, and assertion lanes distinct", () => {
    expect(
      batchClusterCopy(cluster({ id: "relogin" }), [
        {
          id: "case-1",
          index: 0,
          phase: "coverage",
          status: "blocked",
          values: {},
          findingCode: "ACCOUNT_NEEDS_RELOGIN",
          identity: {
            testId: "account-settings",
            environmentId: "default",
            environmentPlatform: "browser",
          },
        },
      ]),
    ).toMatchObject({
      lane: "Infra",
      repair:
        "Sign-in expired. Completed screenshots are saved. Open the browser used for this case, sign in again, and save the updated account. Then choose that account in the Test setup and rerun the affected case.",
      repairTestId: "account-settings",
    });
    expect(
      batchClusterCopy(cluster({ id: "cancel" }), [
        {
          id: "case-1",
          index: 0,
          phase: "coverage",
          status: "cancelled",
          values: {},
          findingCode: "USER_CANCELLED",
        },
      ]).lane,
    ).toBe("Needs review");
  });

  it("names a cancelled SOS cluster as Infra, not Product behavior", () => {
    expect(
      batchClusterCopy(cluster({ id: "c4" }), [
        {
          id: "case-1",
          index: 0,
          phase: "coverage",
          status: "cancelled",
          values: {},
          findingCode: "HARNESS_FAILURE",
          error: "Cancelled by user",
          identity: {
            testId: "toolbar",
            environmentId: "browser:grok-com-1280x800-339a5a430a41",
            environmentPlatform: "browser",
          },
        },
        {
          id: "case-2",
          index: 1,
          phase: "coverage",
          status: "cancelled",
          values: {},
          findingCode: "HARNESS_FAILURE",
        },
      ]),
    ).toEqual({
      lane: "Infra",
      title: "Cancelled",
      meta: "2 cases · Grok com",
    });
  });
});
