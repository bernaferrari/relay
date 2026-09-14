import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProductBatchCase } from "@relay/product/run-across";
import {
  batchRerunRequest,
  batchTriageCaption,
  batchTriageKeyboardCommand,
  batchTriageMutation,
  buildBatchMatrix,
  resolveTriageActor,
  selectedClusterCaseIds,
  shouldShowBatchMatrix,
  visibleBatchCases,
} from "./batch-triage";
import { sortBatchCasesForDisplay } from "./batch-triage-panels";

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
  it("sorts individual matrix cases before passed cases without tinting the whole cell", () => {
    const ordered = sortBatchCasesForDisplay([cases[0]!, { ...cases[1]!, status: "failed" }], true);
    expect(ordered.map((item) => item.status)).toEqual(["failed", "passed"]);
    expect(sortBatchCasesForDisplay(ordered, false)).toBe(ordered);
  });

  it("builds eight Result columns for six accounts plus Android and iOS", () => {
    const environments = [
      ...["account-a", "account-b", "account-c", "account-d", "account-e", "account-f"].map(
        (id) =>
          ({
            id: `send-hello-${id}`,
            index: 0,
            phase: "coverage" as const,
            status: "passed" as const,
            values: {},
            identity: {
              testId: "send-hello",
              environmentId: id,
              environmentPlatform: "browser" as const,
            },
          }) satisfies ProductBatchCase,
      ),
      {
        id: "send-hello-android",
        index: 6,
        phase: "coverage" as const,
        status: "passed" as const,
        values: {},
        identity: {
          testId: "send-hello",
          environmentId: "pixel-8",
          environmentPlatform: "android" as const,
        },
      } satisfies ProductBatchCase,
      {
        id: "send-hello-ios",
        index: 7,
        phase: "coverage" as const,
        status: "passed" as const,
        values: {},
        identity: {
          testId: "send-hello",
          environmentId: "ipad-pro",
          environmentPlatform: "ios" as const,
        },
      } satisfies ProductBatchCase,
    ];
    const matrix = buildBatchMatrix(environments);
    expect(matrix.columns).toHaveLength(8);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.columns.map(({ platform }) => platform).sort()).toEqual([
      "android",
      "browser",
      "browser",
      "browser",
      "browser",
      "browser",
      "browser",
      "ios",
    ]);
  });

  it("labels Result columns with Sign-in names instead of fixture ids", () => {
    const matrix = buildBatchMatrix([
      {
        id: "login-member",
        index: 0,
        phase: "coverage",
        status: "failed",
        values: {},
        identity: {
          testId: "test-authoring-1a2bc3ea12ff",
          environmentId: "browser:grok-com#acct-a:1",
          environmentPlatform: "browser",
          environmentLabel: "f47ac10b-58cc-4372-a567-0e02b2c3d479 · grok-com",
          accountLabel: "Member A",
          targetLabel: "Grok.com",
        },
      },
    ]);
    expect(matrix.columns[0]?.label).toBe("Member A · Grok.com");
    expect(matrix.rows[0]?.label).toBe("Test");
  });

  it("keeps legacy batches useful without fabricating durable identities", () => {
    const matrix = buildBatchMatrix([{ ...cases[0]!, identity: undefined }]);
    expect(matrix.completeIdentity).toBe(false);
    expect(matrix.columns[0]?.label).toBe("Device");
    expect(shouldShowBatchMatrix(matrix)).toBe(false);
    expect(
      visibleBatchCases(
        [
          { ...cases[0]!, identity: undefined, status: "failed" },
          { ...cases[0]!, id: "ok", identity: undefined, status: "passed" },
        ],
        true,
      ).map((item) => item.status),
    ).toEqual(["failed"]);
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

  it("maps keyboard triage ownership onto selected cases", () => {
    expect(
      batchTriageMutation(
        batchTriageKeyboardCommand({
          key: "i",
          selectedCaseIds: ["login-ios", " checkout-ios "],
          actorId: "human:qa",
        }),
      ),
    ).toEqual({ caseIds: ["login-ios", "checkout-ios"], triageStatus: "investigating" });
    expect(
      batchTriageMutation(
        batchTriageKeyboardCommand({
          key: "A",
          selectedCaseIds: ["login-ios"],
          actorId: "human:qa",
        }),
      ),
    ).toEqual({ caseIds: ["login-ios"], assignee: "human:qa" });
    expect(
      batchTriageKeyboardCommand({
        key: "n",
        selectedCaseIds: ["login-ios"],
        actorId: "human:qa",
      }),
    ).toEqual({ kind: "note", caseIds: ["login-ios"] });
    expect(
      batchTriageKeyboardCommand({
        key: "r",
        selectedCaseIds: ["login-ios"],
        actorId: "human:qa",
        target: { tagName: "INPUT" },
      }),
    ).toBeNull();
    expect(
      batchTriageKeyboardCommand({
        key: "r",
        ctrlKey: true,
        selectedCaseIds: ["login-ios"],
        actorId: "human:qa",
      }),
    ).toBeNull();
    expect(
      batchTriageKeyboardCommand({
        key: "r",
        repeat: true,
        selectedCaseIds: ["login-ios"],
        actorId: "human:qa",
      }),
    ).toBeNull();
    expect(
      batchTriageKeyboardCommand({
        key: "r",
        isComposing: true,
        selectedCaseIds: ["login-ios"],
        actorId: "human:qa",
      }),
    ).toBeNull();
    expect(
      batchTriageKeyboardCommand({
        key: "r",
        overlayOpen: true,
        selectedCaseIds: ["login-ios"],
        actorId: "human:qa",
      }),
    ).toBeNull();
    expect(
      batchTriageKeyboardCommand({
        key: "a",
        selectedCaseIds: ["login-ios"],
        actorId: "me",
      }),
    ).toBeNull();
    expect(resolveTriageActor("me")).toBeUndefined();
    expect(resolveTriageActor("human:qa")).toBe("human:qa");
    expect(
      batchTriageKeyboardCommand({
        key: "r",
        selectedCaseIds: [],
        actorId: "human:qa",
      }),
    ).toBeNull();
  });

  it("describes review ownership without changing execution copy", () => {
    expect(
      batchTriageCaption({ ...cases[1]!, triageStatus: "investigating", assignee: "human:qa" }),
    ).toBe("Investigating · Human qa");
    expect(batchTriageCaption({ ...cases[0]!, triageStatus: "unreviewed" })).toBeUndefined();
  });

  it("Batch page wires visible review controls and keyboard through the same command", () => {
    const source = readFileSync("src/routes/batch-page.tsx", "utf8");
    expect(source).toContain("batchTriageKeyboardCommand");
    expect(source).toContain("BatchTriageControls");
    expect(source).toContain("resolveTriageActor");
    expect(source).toContain("runAcrossService.triage");
    expect(source).not.toContain('useState("me")');
  });

  it("keeps an explicit row rerun free of selected cluster ids", () => {
    expect(
      batchRerunRequest({
        explicitCaseIds: ["checkout-chrome"],
        selectedCaseIds: ["login-ios"],
        selectedClusterIds: ["cluster-1"],
      }),
    ).toEqual({ caseIds: ["checkout-chrome"] });
    expect(
      batchRerunRequest({
        selectedCaseIds: ["login-ios"],
        selectedClusterIds: ["cluster-1"],
      }),
    ).toEqual({ caseIds: ["login-ios"], clusterIds: ["cluster-1"] });
  });
});
