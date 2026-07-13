import assert from "node:assert/strict";
import test from "node:test";
import { buildCompatibilityReport } from "./compatibility-report.js";

const pixel = {
  id: "pixel",
  targetId: "pixel-9",
  source: "device" as const,
  platform: "android" as const,
  name: "Pixel 9 · Android 16",
  osVersion: "16",
  capabilities: ["tap" as const],
  observedAt: 1,
};

test("compatibility report groups frozen profiles and computes baseline deltas", () => {
  const report = buildCompatibilityReport(
    [
      {
        id: "before",
        action: "smoke",
        batchId: "older",
        targetProfile: pixel,
        status: "ok",
        queuedAt: 1,
        startedAt: 2,
        finishedAt: 12,
      },
      {
        id: "pass",
        action: "smoke",
        batchId: "batch",
        targetProfile: pixel,
        status: "ok",
        queuedAt: 20,
        startedAt: 21,
        finishedAt: 41,
        artifacts: [
          {
            kind: "compatibility-profile",
            data: { matrixId: "release", matrixName: "Release smoke" },
          },
        ],
      },
      {
        id: "product-failure",
        action: "smoke",
        batchId: "batch",
        targetProfile: pixel,
        status: "error",
        outcome: "product-failure" as const,
        queuedAt: 22,
        startedAt: 23,
        finishedAt: 53,
      },
    ],
    "batch",
  );
  assert.equal(report?.matrixName, "Release smoke");
  assert.equal(report?.profiles.length, 1);
  assert.equal(report?.profiles[0]?.passRate, 0.5);
  assert.equal(report?.profiles[0]?.medianDurationMs, 25);
  assert.equal(report?.profiles[0]?.baseline?.passRateDelta, -0.5);
  assert.equal(report?.profiles[0]?.baseline?.durationDeltaMs, 15);
});

test("compatibility report ignores non-matrix jobs", () => {
  assert.equal(buildCompatibilityReport([{ id: "x", action: "a", status: "ok" }], "batch"), null);
});
