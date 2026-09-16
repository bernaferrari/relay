import assert from "node:assert/strict";
import test from "node:test";
import { graphTest } from "./app-map-test-operation-schemas.js";
import { operationInputSchemas } from "./operation-input-schemas.js";
import { operationDefinition } from "./operations.js";
import { CAPTURE_REVIEW_ACTIONS } from "./capture-review.js";

test("run.capture.review accepts Looks correct without a baseline action", () => {
  const input = {
    runId: "run-8",
    captureId: "frames/001.png::aaa",
    action: "accept" as const,
    imageSha256: "aaa",
  };
  assert.deepEqual(operationDefinition("run.capture.review").input.parse(input), input);
  assert.deepEqual(operationInputSchemas["run.capture.review"].parse(input), input);
  assert.deepEqual([...CAPTURE_REVIEW_ACTIONS], ["accept", "report-issue", "need-more-evidence"]);
  for (const action of ["approve-new-baseline", "approve", "reject"] as const) {
    assert.throws(
      () =>
        operationDefinition("run.capture.review").input.parse({
          runId: "run-8",
          captureId: "frames/001.png::aaa",
          action,
        }),
      /unsupported|invalid_value|Invalid option/u,
    );
  }
});

test("graph Test schema accepts capture-for-review without a judge", () => {
  assert.doesNotThrow(() =>
    graphTest.parse({
      name: "Arabic settings",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [
        {
          id: "capture-settings",
          intent: "Capture settings for a person to review later",
          kind: "validation",
          binding: {
            status: "resolved",
            kind: "recipe-step",
            step: {
              kind: "screenshot",
              caption: "Arabic account settings",
              review: { mode: "later", lookFor: "Save is visible" },
            },
          },
        },
      ],
    }),
  );
});
