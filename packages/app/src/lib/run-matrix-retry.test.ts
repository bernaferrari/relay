import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import { projectRunMatrix } from "./run-matrix-review";
import { retryProblemMatrix } from "./run-matrix-retry";

function localeJob(id: string, status: JobInfo["status"]): JobInfo {
  return {
    id,
    action: "language-x-tour",
    status,
    queuedAt: 1,
    logs: [],
    matrixCase: {
      kind: "combine",
      appMapId: "settings",
      combineId: "language-x-tour",
      world: id,
      values: { language: id },
    },
  } as JobInfo;
}

test("a repaired locale matrix recompiles current truth and keeps green cells", async () => {
  const review = projectRunMatrix([localeJob("en", "ok"), localeJob("it", "error")]);
  assert.ok(review);
  const current: unknown[] = [];
  const frozen: string[] = [];
  const result = await retryProblemMatrix(review, {
    runCurrent: (input) => {
      current.push(input);
      return Promise.resolve("new-batch");
    },
    retryFrozen: (id) => {
      frozen.push(id);
      return Promise.resolve();
    },
  });
  assert.deepEqual(result, { kind: "current-locales", count: 1 });
  assert.deepEqual(current, [
    {
      appMapId: "settings",
      combineId: "language-x-tour",
      selected: { language: ["it"] },
      title: "Retry 1 problem locale",
    },
  ]);
  assert.deepEqual(frozen, []);
});
