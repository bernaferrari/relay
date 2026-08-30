import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeProofExecutionRecord } from "@relay/core";
import { changeProofCellRunInput } from "./change-proof-cell-executor.js";

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
  assert.equal(input.sourceRevision?.buildId, undefined);
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
