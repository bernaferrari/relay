import assert from "node:assert/strict";
import test from "node:test";
import {
  queueablePreparedCombineCells,
  unrecordedPreparedCombineReason,
} from "./app-map-combine-cell-run.js";
import type { PreparedAppMapCombineCell } from "./app-map-combine-cell-prepare.js";

function cell(
  executableOperations: number,
  reason?: string,
): Pick<PreparedAppMapCombineCell, "plan"> {
  return {
    plan: {
      performance: {
        executableOperations,
        moduleCalls: 0,
        operationCounts: {},
        screenshotCount: 0,
        destinationProofCount: 0,
      },
      ...(reason
        ? { omittedSteps: [{ stepId: "open", intent: "Open", reason, repairTargetId: "open" }] }
        : {}),
    },
  } as Pick<PreparedAppMapCombineCell, "plan">;
}

test("unrecorded native compiles are skipped, not passed", () => {
  const skipped = cell(0, "No recorded Android route. Do not invent Grok Settings navigation.");
  const leftoverCapture = cell(1, "No recorded iOS route. Do not invent Grok Settings navigation.");
  const runnable = cell(4);
  assert.match(unrecordedPreparedCombineReason(skipped) ?? "", /Android/u);
  assert.match(unrecordedPreparedCombineReason(leftoverCapture) ?? "", /iOS/u);
  assert.equal(unrecordedPreparedCombineReason(runnable), undefined);
  assert.equal(queueablePreparedCombineCells([skipped, leftoverCapture, runnable]).length, 1);
});
