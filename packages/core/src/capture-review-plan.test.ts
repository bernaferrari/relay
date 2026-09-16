import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTURE_REVIEW_DEST_PHASE,
  CAPTURE_REVIEW_LEFTOVER_PHASE,
  captureReviewId,
  captureReviewSlotId,
} from "@relay/protocol";
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
      status: "blocked" as const,
      outcome: "harness-failure" as const,
      artifacts: [],
      recipeSnapshot: { steps: [settingsStep] },
    },
  ]);
  assert.equal(queue.summary.planned, 2);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.blocked, 1);
  assert.equal(queue.summary.missing, 0);
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

test("Looks correct cannot accept a blocked Plan slot that stays in the denominator", () => {
  const captured = run("run-1", "frames/001.png", "aaa");
  const imagineStep = {
    id: "imagine",
    kind: "screenshot",
    caption: "Imagine",
    review: { mode: "later" },
  };
  const blockedRun = {
    id: "run-imagine",
    status: "blocked" as const,
    outcome: "harness-failure" as const,
    artifacts: [],
    recipeSnapshot: { steps: [imagineStep] },
  };
  const queue = captureReviewQueueForPlan([captured, blockedRun]);
  assert.equal(queue.summary.planned, 2);
  assert.equal(queue.summary.blocked, 1);
  assert.equal(queue.summary.missing, 0);
  const blocked = queue.items.find((item) => item.blocked);
  assert.ok(blocked);
  const applied = applyPlanCaptureReviewDecisions([captured, blockedRun], {
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    items: [{ runId: "run-imagine", captureId: blocked.captureId }],
  });
  assert.equal(applied.results[0]?.status, "missing");
  assert.match(applied.results[0]?.error ?? "", /blocked screenshot/u);
  assert.equal(applied.queue.summary.accepted, 0);
  assert.equal(applied.queue.summary.blocked, 1);
  assert.equal(applied.queue.summary.pending, 1);
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

test("Plan dest-phase identity is not overwritten by leftover Close/Back", () => {
  const dest = {
    requirementId: "rc23-screenshot-first",
    checkpointId: "logo",
    caption: "Logo",
    lookFor: "Speak home chrome",
    stepId: "relay-test-logo-dest",
    attempt: 1,
    phase: CAPTURE_REVIEW_DEST_PHASE,
    configuration: { app: "android" },
  };
  const queue = captureReviewQueueForPlan([
    {
      id: "run-logo",
      status: "ok",
      artifacts: [
        {
          kind: "capture-review",
          capturedAt: 1,
          data: {
            caption: dest.caption,
            framePath: "frames/005.png",
            imageSha256: "home-leftover",
            stepId: dest.stepId,
            checkpointId: dest.checkpointId,
            attempt: 1,
            phase: CAPTURE_REVIEW_LEFTOVER_PHASE,
            configuration: dest.configuration,
          },
        },
        {
          kind: "capture-review",
          capturedAt: 2,
          data: {
            caption: dest.caption,
            framePath: "frames/002.png",
            imageSha256: "automations-settings",
            stepId: dest.stepId,
            slotId: captureReviewSlotId(dest),
            checkpointId: dest.checkpointId,
            attempt: 1,
            phase: CAPTURE_REVIEW_DEST_PHASE,
            configuration: dest.configuration,
          },
        },
        {
          kind: "app-map-combine-cell-execution-intent",
          capturedAt: 1,
          data: {
            digest: "not-a-canonical-intent",
            child: { plan: { plannedSlots: [dest] } },
          },
        },
      ],
    },
  ]);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(queue.items[0]?.framePath, "frames/002.png");
  assert.notEqual(queue.items[0]?.framePath, "frames/005.png");
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 0);
});

test("bulk Looks correct keeps notes when a later selected image conflicts", () => {
  const member = run("run-member", "frames/001.png", "aaa");
  const admin = run("run-admin", "frames/002.png", "bbb");
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
  const applied = applyPlanCaptureReviewDecisions([member, admin], {
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    items: [
      {
        runId: "run-member",
        captureId: memberId,
        imageSha256: "aaa",
        note: "Save is visible",
      },
      { runId: "run-admin", captureId: adminId, imageSha256: "stale" },
    ],
  });
  assert.deepEqual(
    applied.results.map((result) => result.status),
    ["applied", "conflict"],
  );
  assert.equal(applied.queue.summary.accepted, 1);
  assert.equal(applied.queue.summary.pending, 1);
  assert.equal(
    applied.runs.find((item) => item.runId === "run-member")?.captureReviews[0]?.note,
    "Save is visible",
  );
  assert.equal(applied.runs.find((item) => item.runId === "run-admin")?.captureReviews.length, 0);
});

test("a second Plan reviewer cannot overwrite the first reviewer's saved decision", () => {
  const member = run("run-member", "frames/001.png", "aaa", { account: "Member" });
  const admin = run("run-admin", "frames/002.png", "bbb", { account: "Admin" });
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
  const first = applyPlanCaptureReviewDecisions([member, admin], {
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    items: [
      {
        runId: "run-member",
        captureId: memberId,
        imageSha256: "aaa",
        note: "Member Save is visible",
      },
    ],
  });
  const second = applyPlanCaptureReviewDecisions(
    [{ ...member, captureReviews: first.runs[0]?.captureReviews }, admin],
    {
      action: "report-issue",
      actor: { id: "human:alex", kind: "human" },
      items: [
        { runId: "run-member", captureId: memberId, imageSha256: "aaa" },
        {
          runId: "run-admin",
          captureId: adminId,
          imageSha256: "bbb",
          note: "Admin seats stay 99",
        },
      ],
    },
  );
  assert.deepEqual(
    second.results.map((result) => result.status),
    ["conflict", "applied"],
  );
  assert.equal(
    second.runs.find((item) => item.runId === "run-member")?.captureReviews[0]?.decidedBy.id,
    "human:maria",
  );
  assert.equal(
    second.runs.find((item) => item.runId === "run-member")?.captureReviews[0]?.note,
    "Member Save is visible",
  );
  assert.equal(
    second.runs.find((item) => item.runId === "run-admin")?.captureReviews[0]?.decidedBy.id,
    "human:alex",
  );
  assert.equal(second.queue.summary.accepted, 1);
  assert.equal(second.queue.summary.issue, 1);
});

test("thirty explicitly selected Plan captures apply without waiting for more generation", () => {
  const runs = Array.from({ length: 30 }, (_, index) => {
    if (index === 29) {
      return {
        id: "run-imagine",
        status: "blocked" as const,
        outcome: "harness-failure" as const,
        artifacts: [],
        recipeSnapshot: {
          steps: [
            { id: "imagine", kind: "screenshot", caption: "Imagine", review: { mode: "later" } },
          ],
        },
      };
    }
    return {
      ...run(`run-${index}`, `frames/${String(index + 1).padStart(3, "0")}.png`, `sha-${index}`),
      outcome: "passed" as const,
    };
  });
  const queue = captureReviewQueueForPlan(runs);
  assert.equal(queue.summary.planned, 30);
  assert.equal(queue.summary.captured, 29);
  assert.equal(queue.summary.blocked, 1);
  const applied = applyPlanCaptureReviewDecisions(runs, {
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    items: queue.items.map((item) => ({
      runId: item.runId,
      captureId: item.captureId,
      ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
    })),
  });
  assert.equal(applied.results.length, 30);
  assert.equal(applied.results.filter((result) => result.status === "applied").length, 29);
  assert.equal(applied.results.filter((result) => result.status === "missing").length, 1);
  assert.equal(applied.queue.summary.accepted, 29);
  assert.equal(applied.queue.summary.pending, 0);
  assert.equal(applied.queue.summary.blocked, 1);
  assert.equal(applied.queue.summary.planned, 30);
  assert.equal(
    applied.runs.find((item) => item.runId === "run-imagine")?.captureReviews.length ?? 0,
    0,
  );
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
