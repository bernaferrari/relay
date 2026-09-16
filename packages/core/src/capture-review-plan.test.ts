import assert from "node:assert/strict";
import test from "node:test";
import { captureReviewId } from "@relay/protocol";
import { CaptureReviewError } from "./capture-review.js";
import {
  applyPlanCaptureReviewDecisions,
  captureReviewQueueForPlan,
  resolveUniquePlanBatchId,
} from "./capture-review-plan.js";

const settingsStep = {
  id: "settings",
  kind: "screenshot",
  caption: "Settings",
  review: { mode: "later" },
};

function run(
  id: string,
  frame: string,
  sha: string,
  extras: { account?: string; serial?: string } = {},
) {
  return {
    id,
    status: "ok",
    ...(extras.serial ? { serial: extras.serial } : {}),
    artifacts: [
      {
        kind: "capture-review",
        capturedAt: 1,
        data: {
          caption: "Settings",
          framePath: frame,
          imageSha256: sha,
          checkpointId: "settings",
          stepId: "settings",
          attempt: 1,
          ...(extras.account ? { configuration: { account: extras.account } } : {}),
        },
      },
    ],
    recipeSnapshot: { steps: [settingsStep] },
  };
}

test("Plan capture review aggregates Runs and keeps missing in the denominator", () => {
  const queue = captureReviewQueueForPlan([
    run("run-1", "frames/001.png", "aaa"),
    {
      id: "run-2",
      status: "blocked",
      outcome: "harness-failure",
      artifacts: [],
      recipeSnapshot: { steps: [settingsStep] },
    },
  ]);
  assert.equal(queue.summary.planned, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.summary.blocked, 1);
});

test("bulk Looks correct writes the existing capture-review store for exact items only", () => {
  const member = run("run-member", "frames/001.png", "aaa");
  const admin = run("run-admin", "frames/002.png", "bbb");
  const extra = run("run-extra", "frames/003.png", "ccc");
  const memberId = captureReviewId({
    caption: "Settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const adminId = captureReviewId({
    caption: "Settings",
    framePath: "frames/002.png",
    imageSha256: "bbb",
  });
  const applied = applyPlanCaptureReviewDecisions([member, admin, extra], {
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    items: [
      { runId: "run-member", captureId: memberId, imageSha256: "aaa" },
      { runId: "run-admin", captureId: adminId, imageSha256: "bbb" },
    ],
  });
  assert.equal(applied.queue.summary.accepted, 2);
  assert.equal(applied.queue.summary.pending, 1);
  assert.equal(applied.queue.items.find((item) => item.runId === "run-extra")?.status, "pending");
  assert.deepEqual(
    applied.results.map((result) => result.status),
    ["applied", "applied"],
  );
  assert.equal(applied.runs.find((item) => item.runId === "run-extra")?.captureReviews.length, 0);
});

test("filtered bulk Looks correct skips hidden Plan captures", () => {
  const memberId = captureReviewId({
    caption: "Settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const adminId = captureReviewId({
    caption: "Settings",
    framePath: "frames/002.png",
    imageSha256: "bbb",
  });
  const applied = applyPlanCaptureReviewDecisions(
    [
      run("run-member", "frames/001.png", "aaa", { account: "Member", serial: "iPad" }),
      run("run-admin", "frames/002.png", "bbb", { account: "Admin", serial: "Chrome" }),
    ],
    {
      action: "accept",
      actor: { id: "human:maria", kind: "human" },
      filter: { pending: true, account: "Member", device: "iPad" },
      items: [
        { runId: "run-member", captureId: memberId, imageSha256: "aaa" },
        { runId: "run-admin", captureId: adminId, imageSha256: "bbb" },
      ],
    },
  );
  assert.equal(applied.queue.summary.accepted, 1);
  assert.equal(applied.queue.summary.pending, 1);
  assert.equal(applied.queue.summary.planned, 2);
  assert.equal(applied.results[0]?.status, "applied");
  assert.equal(applied.results[1]?.status, "not-found");
  assert.match(applied.results[1]?.error ?? "", /hidden by the current review filter/u);
  assert.equal(applied.runs.find((item) => item.runId === "run-admin")?.captureReviews.length, 0);
});

test("Plan account filter ignores a SuperGrok overlay on a signed-out capture", () => {
  const daily = {
    ...run("run-daily", "frames/daily.png", "daily", { account: "signed-out" }),
    resolvedInputs: { account: "SuperGrok" },
  };
  const queue = captureReviewQueueForPlan([daily]);
  assert.equal(queue.items[0]?.account, "signed-out");
  const spoofed = applyPlanCaptureReviewDecisions([daily], {
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    filter: { account: "SuperGrok" },
    items: [
      {
        runId: "run-daily",
        captureId: captureReviewId({
          caption: "Settings",
          framePath: "frames/daily.png",
          imageSha256: "daily",
        }),
        imageSha256: "daily",
      },
    ],
  });
  assert.equal(spoofed.results[0]?.status, "not-found");
  assert.match(spoofed.results[0]?.error ?? "", /hidden by the current review filter/u);
  assert.equal(spoofed.queue.summary.accepted, 0);
});

test("agents cannot bulk-accept Plan captures", () => {
  const member = run("run-member", "frames/001.png", "aaa");
  const captureId = captureReviewId({
    caption: "Settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  assert.throws(
    () =>
      applyPlanCaptureReviewDecisions([member], {
        action: "accept",
        actor: { id: "agent:cursor", kind: "agent" },
        items: [{ runId: "run-member", captureId, imageSha256: "aaa" }],
      }),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED",
  );
});

test("agent:cursor cannot impersonate a human Plan Looks correct", () => {
  const member = run("run-member", "frames/001.png", "aaa");
  const captureId = captureReviewId({
    caption: "Settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  assert.throws(
    () =>
      applyPlanCaptureReviewDecisions([member], {
        action: "accept",
        actor: { id: "agent:cursor", kind: "human" },
        items: [{ runId: "run-member", captureId, imageSha256: "aaa" }],
      }),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED",
  );
});

test("Looks correct on a Plan queue does not accept a missing recapture", () => {
  const captured = run("run-1", "frames/001.png", "aaa");
  const missingRun = {
    id: "run-2",
    status: "ok",
    artifacts: [],
    recipeSnapshot: { steps: [settingsStep] },
  };
  const missing = captureReviewQueueForPlan([captured, missingRun]).items.find(
    (item) => item.status === "missing",
  );
  assert.ok(missing);
  const applied = applyPlanCaptureReviewDecisions([captured, missingRun], {
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    items: [{ runId: "run-2", captureId: missing.captureId }],
  });
  assert.equal(applied.results[0]?.status, "missing");
  assert.equal(applied.queue.summary.accepted, 0);
  assert.equal(applied.queue.summary.missing, 1);
});

test("Plan capture review reads Combine cell child plannedSlots without a digest parse", () => {
  const queue = captureReviewQueueForPlan([
    {
      id: "run-cell",
      status: "ok",
      artifacts: [
        {
          kind: "app-map-combine-cell-execution-intent",
          capturedAt: 1,
          data: {
            digest: "not-a-canonical-intent",
            child: {
              plan: {
                plannedSlots: [
                  {
                    requirementId: "test-home",
                    checkpointId: "step-action",
                    caption: "Home chrome",
                    stepId: "step-action",
                    attempt: 1,
                  },
                ],
              },
            },
          },
        },
      ],
    },
  ]);
  assert.equal(queue.summary.planned, 1);
  assert.equal(queue.summary.captured, 0);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.items[0]?.caption, "Home chrome");
});

test("unique Plan batch prefix selects the existing campaign", () => {
  assert.equal(
    resolveUniquePlanBatchId("d7eafb3c", ["d7eafb3c-4534-4027-8480-9d075ea4fb0f"]),
    "d7eafb3c-4534-4027-8480-9d075ea4fb0f",
  );
  assert.equal(
    resolveUniquePlanBatchId("d7eafb3c-4534-4027-8480-9d075ea4fb0f", [
      "d7eafb3c-4534-4027-8480-9d075ea4fb0f",
    ]),
    "d7eafb3c-4534-4027-8480-9d075ea4fb0f",
  );
});

test("ambiguous Plan batch prefix does not pick a later campaign", () => {
  assert.throws(
    () =>
      resolveUniquePlanBatchId("d7e", [
        "d7eafb3c-4534-4027-8480-9d075ea4fb0f",
        "d7eafb3c-9999-4027-8480-9d075ea4fb0f",
      ]),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_UNAVAILABLE",
  );
});
