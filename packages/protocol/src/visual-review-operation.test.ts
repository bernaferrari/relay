import assert from "node:assert/strict";
import test from "node:test";
import { operationInputSchemas } from "./operation-input-schemas.js";
import { operationDefinition } from "./operations.js";
import { VISUAL_REVIEW_ACTIONS } from "./visual-verification.js";

test("run.visual.review accepts approve-new-baseline and rejects Findings approve|reject", () => {
  const input = {
    runId: "run-7",
    comparisonId: "visual-comparison-7ea9041e512488dde59c645a",
    action: "approve-new-baseline" as const,
  };
  assert.deepEqual(operationDefinition("run.visual.review").input.parse(input), input);
  assert.deepEqual(operationInputSchemas["run.visual.review"].parse(input), input);
  assert.deepEqual(
    [...VISUAL_REVIEW_ACTIONS],
    ["approve-new-baseline", "keep-baseline", "fix-connection", "retry", "mark-expected-variation"],
  );
  for (const action of ["approve", "reject"] as const) {
    assert.throws(
      () =>
        operationDefinition("run.visual.review").input.parse({
          runId: "run-7",
          comparisonId: "cmp-1",
          action,
        }),
      /unsupported|invalid_value|Invalid option/u,
    );
  }
});
