import { describe, expect, it } from "vitest";
import type { ProductBatchCase } from "@relay/product/run-across";
import { buildBatchMatrix, selectedClusterCaseIds } from "./batch-triage";

const cases: ProductBatchCase[] = [
  {
    id: "checkout-chrome",
    index: 0,
    phase: "coverage",
    status: "passed",
    values: { locale: "en" },
    runId: "run-1",
    identity: {
      testId: "checkout",
      environmentId: "chrome-desktop",
      environmentPlatform: "browser",
      runId: "run-1",
    },
  },
  {
    id: "login-ios",
    index: 1,
    phase: "coverage",
    status: "failed",
    values: { locale: "pt" },
    runId: "run-2",
    identity: {
      testId: "login",
      environmentId: "iphone-15",
      environmentPlatform: "ios",
      runId: "run-2",
    },
  },
];

describe("Batch triage presentation", () => {
  it("builds a failure-first Test by Environment matrix", () => {
    const matrix = buildBatchMatrix(cases);
    expect(matrix.completeIdentity).toBe(true);
    expect(matrix.rows.map(({ id }) => id)).toEqual(["login", "checkout"]);
    expect(matrix.columns.map(({ id }) => id)).toEqual(["chrome-desktop", "iphone-15"]);
    expect(matrix.rows[0]?.cells.get("iphone-15")?.cases[0]?.id).toBe("login-ios");
  });

  it("keeps legacy batches useful without fabricating durable identities", () => {
    const matrix = buildBatchMatrix([{ ...cases[0]!, identity: undefined }]);
    expect(matrix.completeIdentity).toBe(false);
    expect(matrix.columns[0]?.label).toBe("Selected environment");
  });

  it("expands selected failure clusters into exact case ids", () => {
    expect(
      selectedClusterCaseIds(
        [
          {
            id: "cluster-1",
            kind: "visual",
            signature: {
              kind: "visual",
              digest: "sha256:a",
              summary: "Visual mismatch",
              checkIds: [],
            },
            environmentId: "iphone-15",
            representativeCaseId: "login-ios",
            representativeRunId: "run-2",
            caseIds: ["login-ios", "checkout-ios"],
          },
        ],
        new Set(["cluster-1"]),
      ),
    ).toEqual(["checkout-ios", "login-ios"]);
  });
});
