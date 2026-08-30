import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeProofExecutionRecord } from "@relay/core";
import { changeProofCellRunInput } from "./change-proof-cell-executor.js";
import { canonicalSha256 } from "@relay/core";

const safeExecutionRisk = {
  schemaVersion: 1 as const,
  level: "safe" as const,
  reasons: [],
  externalEffects: [],
  confirmation: "none" as const,
  expectedAppBoundaries: [],
  cleanupRequired: false,
};
const prohibitedExecutionRisk = {
  ...safeExecutionRisk,
  level: "prohibited" as const,
  confirmation: "human-only" as const,
  reasons: [{ code: "reviewed-effect.purchase", explanation: "Purchase effect." }],
  externalEffects: ["purchase" as const],
};

const execution = (
  platform: "browser" | "ios",
  cellDimensions: Record<string, string> = { locale: "ar" },
) =>
  ({
    frozenProof: {
      change: { headSha: "2".repeat(40) },
      builds: [
        {
          id: "build-1",
          platform: platform === "browser" ? "web" : platform,
          sourceSha: "2".repeat(40),
          artifactDigest: `sha256:${"a".repeat(64)}`,
          configuration: "production",
          environmentRevision: "fixture-v1",
        },
      ],
      selection: {
        targetCases: [
          {
            id: "target-1",
            executionTarget: {
              schemaVersion: 1,
              kind: platform === "browser" ? "local-browser" : "physical-ios",
              provider: { key: "relay.test", scope: "local" },
              targetId: platform === "browser" ? "web" : "ios-1",
              platform,
              identity: { kind: "test-target", value: "target-1" },
            },
            targetProfile: { id: "profile-1" },
            dimensions: { locale: "ar" },
          },
        ],
        cells: [
          {
            id: "cell-1",
            journey: { appMapId: "settings", testId: "language", appMapRevision: 4 },
            targetCaseId: "target-1",
            buildId: "build-1",
            requirement: "required",
            selectionReason: "Reviewed exact execution cell.",
            dimensions: cellDimensions,
            executionRisk: safeExecutionRisk,
            executionRiskDigest: canonicalSha256(safeExecutionRisk),
            cleanupRequired: false,
          },
        ],
      },
    },
  }) as unknown as Pick<ChangeProofExecutionRecord, "frozenProof">;

test("the default cell adapter binds a browser deployment without an invalid build id", () => {
  const input = changeProofCellRunInput(execution("browser"), {
    cellId: "cell-1",
    appMapId: "settings",
    testId: "language",
    appMapRevision: 4,
    targetCaseId: "target-1",
    buildId: "build-1",
  });
  assert.deepEqual(input.target, { kind: "browser", platform: "browser", targetId: "web" });
  assert.equal(input.sourceRevision?.buildId, "build-1");
  assert.equal(input.sourceRevision?.artifactDigest, `sha256:${"a".repeat(64)}`);
});

test("the default cell adapter retains registered build identity for a device", () => {
  const input = changeProofCellRunInput(execution("ios"), {
    cellId: "cell-1",
    appMapId: "settings",
    testId: "language",
    appMapRevision: 4,
    targetCaseId: "target-1",
    buildId: "build-1",
  });
  assert.deepEqual(input.target, { kind: "device", platform: "ios", targetId: "ios-1" });
  assert.equal(input.sourceRevision?.buildId, "build-1");
});

test("the default cell adapter executes reviewed non-target dimensions as one exact Repeat", () => {
  const input = changeProofCellRunInput(execution("browser", { locale: "ar", theme: "dark" }), {
    cellId: "cell-1",
    appMapId: "settings",
    testId: "language",
    appMapRevision: 4,
    targetCaseId: "target-1",
    buildId: "build-1",
  });

  assert.deepEqual(input.in, { theme: ["dark"] });
  assert.deepEqual(input.pilotCase, { theme: "dark" });
  assert.equal(input.executionMode, "pilot");
});

test("the default cell adapter refuses a cell without frozen risk authority", () => {
  const value = execution("browser");
  const cell = value.frozenProof.selection.cells![0]!;
  value.frozenProof.selection.cells = [
    (({ executionRisk: _risk, executionRiskDigest: _digest, ...withoutAuthority }) =>
      withoutAuthority)(cell),
  ] as never;
  assert.throws(
    () =>
      changeProofCellRunInput(value, {
        cellId: "cell-1",
        appMapId: "settings",
        testId: "language",
        appMapRevision: 4,
        targetCaseId: "target-1",
        buildId: "build-1",
      }),
    /no frozen execution-risk authority/u,
  );
});

test("the default cell adapter refuses prohibited or confirmation-gated risk", () => {
  const value = execution("browser");
  const cell = value.frozenProof.selection.cells![0]!;
  value.frozenProof.selection.cells = [
    {
      ...cell,
      executionRisk: prohibitedExecutionRisk,
      executionRiskDigest: canonicalSha256(prohibitedExecutionRisk),
    },
  ] as never;
  assert.throws(
    () =>
      changeProofCellRunInput(value, {
        cellId: "cell-1",
        appMapId: "settings",
        testId: "language",
        appMapRevision: 4,
        targetCaseId: "target-1",
        buildId: "build-1",
      }),
    /only safe\/none Proof execution is currently supported/u,
  );
});
