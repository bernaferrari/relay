import assert from "node:assert/strict";
import test from "node:test";
import { summarizeJob, type TestJob } from "./session.js";

test("job summaries expose only the safe matrix identity needed by live review", () => {
  const job = {
    id: "job-1",
    action: "settings-tour",
    title: "Italiano · Settings",
    status: "running",
    queuedAt: 10,
    startedAt: 20,
    platform: "android",
    targetKind: "device",
    serial: "pixel",
    logs: [],
    frames: [],
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 10,
        data: {
          kind: "combine",
          combineId: "language-x-settings",
          world: "Italiano",
          values: { language: "it-IT", language_label: "Italiano" },
          expectedScreenshots: 10,
          privateToken: "must-not-leak",
        },
      },
    ],
    batchId: "batch-1",
    caseIndex: 1,
    caseCount: 2,
  } as unknown as TestJob;

  assert.deepEqual(summarizeJob(job).matrixCase, {
    kind: "combine",
    combineId: "language-x-settings",
    world: "Italiano",
    values: { language: "it-IT", language_label: "Italiano" },
    expectedScreenshots: 10,
  });
  assert.equal(JSON.stringify(summarizeJob(job)).includes("must-not-leak"), false);
});

test("job summaries discard malformed matrix values instead of trusting artifact casts", () => {
  const job = {
    id: "job-2",
    action: "settings-tour",
    status: "queued",
    queuedAt: 10,
    platform: "android",
    targetKind: "device",
    serial: "pixel",
    logs: [],
    frames: [],
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 10,
        data: {
          kind: "combine",
          world: "Italiano",
          values: { language: "it-IT", unsafe: { token: "secret" } },
        },
      },
    ],
  } as unknown as TestJob;

  assert.deepEqual(summarizeJob(job).matrixCase?.values, { language: "it-IT" });
});
