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
  assert.deepEqual(
    [...CAPTURE_REVIEW_ACTIONS],
    ["accept", "accept-as-reference", "report-issue", "need-more-evidence"],
  );
  assert.equal(
    operationDefinition("run.capture.review").input.parse({
      ...input,
      action: "accept-as-reference",
    }).action,
    "accept-as-reference",
  );
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

test("Plan capture review lists the queue and bulk-accepts exact items only", () => {
  const listed = operationDefinition("job.combine.capture.review").input.parse({
    batchId: "plan-1",
  });
  assert.deepEqual(listed, { batchId: "plan-1" });
  const filtered = operationDefinition("job.combine.capture.review").input.parse({
    batchId: "plan-1",
    pending: "true",
    screen: "Settings",
    device: "iPad",
    account: "Member",
  });
  assert.deepEqual(filtered, {
    batchId: "plan-1",
    pending: true,
    screen: "Settings",
    device: "iPad",
    account: "Member",
  });
  const applied = {
    batchId: "plan-1",
    action: "accept" as const,
    items: [
      {
        runId: "run-8",
        captureId: "frames/001.png::aaa",
        imageSha256: "aaa",
        note: "Save is visible",
      },
    ],
    pending: true,
    screen: "Settings",
  };
  assert.deepEqual(operationDefinition("job.combine.capture.review.apply").input.parse(applied), {
    ...applied,
    pending: true,
  });
  assert.throws(
    () =>
      operationDefinition("job.combine.capture.review.apply").input.parse({
        batchId: "plan-1",
        action: "approve-new-baseline",
        items: [{ runId: "run-8", captureId: "frames/001.png::aaa" }],
      }),
    /unsupported|invalid_value|Invalid option/u,
  );
});
