import assert from "node:assert/strict";
import test from "node:test";
import { captureReviewId, captureReviewSlotId } from "@relay/protocol";
import {
  applyCaptureReviewDecision,
  captureReviewQueueForRun,
  CaptureReviewError,
} from "./capture-review.js";

const artifact = {
  kind: "capture-review",
  capturedAt: 1,
  data: {
    caption: "Arabic account settings",
    lookFor: "Save is visible",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  },
};

test("Looks correct binds to the exact image and does not change execution outcome", () => {
  const applied = applyCaptureReviewDecision(
    {
      artifacts: [artifact],
      outcome: "product-failure",
      recipeSnapshot: { steps: [] },
    },
    {
      captureId: captureReviewId({
        caption: "Arabic account settings",
        framePath: "frames/001.png",
        imageSha256: "aaa",
      }),
      action: "accept",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
    },
  );
  assert.equal(applied.outcome, "product-failure");
  assert.equal(applied.queue.items[0]?.status, "accepted");
  assert.equal(applied.queue.summary.accepted, 1);
  assert.equal(applied.queue.summary.pending, 0);
});

test("Looks correct does not copy ui-tree chrome into a baseline ignore list", () => {
  const applied = applyCaptureReviewDecision(
    {
      artifacts: [
        artifact,
        {
          kind: "ui-tree",
          capturedAt: 1,
          data: {
            stepId: "chat",
            nodes: [
              { role: "article", label: "You", rect: { x: 80, y: 80, width: 40, height: 40 } },
              {
                role: "div",
                identifier: "chat-input",
                label: "Ask Grok anything",
                rect: { x: 275, y: 232, width: 726, height: 42 },
              },
            ],
          },
        },
      ],
      outcome: "passed",
      recipeSnapshot: { steps: [] },
    },
    {
      captureId: captureReviewId({
        caption: "Arabic account settings",
        framePath: "frames/001.png",
        imageSha256: "aaa",
      }),
      action: "accept",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
    },
  );
  assert.equal(applied.outcome, "passed");
  assert.equal(applied.queue.items[0]?.status, "accepted");
  assert.equal(applied.queue.items[0]?.masks, undefined);
  assert.equal(applied.captureReviews.length, 1);
});

test("Looks correct does not copy identity-ignore into a baseline ignore list", () => {
  const applied = applyCaptureReviewDecision(
    {
      artifacts: [
        artifact,
        {
          kind: "identity-ignore",
          capturedAt: 1,
          data: { name: "reply body", x: 0, y: 0.1, width: 1, height: 0.8, frameIndex: 0 },
        },
      ],
      outcome: "passed",
      recipeSnapshot: { steps: [] },
    },
    {
      captureId: captureReviewId({
        caption: "Arabic account settings",
        framePath: "frames/001.png",
        imageSha256: "aaa",
      }),
      action: "accept",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
    },
  );
  assert.equal(applied.outcome, "passed");
  assert.equal(applied.queue.items[0]?.status, "accepted");
  assert.equal(applied.queue.items[0]?.masks, undefined);
  assert.equal(applied.captureReviews.length, 1);
  assert.equal(applied.captureReviews[0]?.action, "accept");
});

test("identity-ignore does not count as a visual baseline", () => {
  const applied = applyCaptureReviewDecision(
    {
      artifacts: [
        artifact,
        {
          kind: "identity-ignore",
          capturedAt: 1,
          data: { name: "clock", x: 0.8, y: 0, width: 0.2, height: 0.05, frameIndex: 0 },
        },
      ],
      outcome: "passed",
      recipeSnapshot: { steps: [] },
    },
    {
      captureId: captureReviewId({
        caption: "Arabic account settings",
        framePath: "frames/001.png",
        imageSha256: "aaa",
      }),
      action: "accept",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
    },
  );
  assert.equal(applied.captureReviews[0]?.action, "accept");
  assert.equal("approvedBaselineId" in (applied.captureReviews[0] ?? {}), false);
  assert.equal(applied.queue.items[0]?.masks, undefined);
  assert.equal(applied.outcome, "passed");
});

test("a missing screenshot stays missing and cannot be accepted", () => {
  const run = {
    artifacts: [],
    recipeSnapshot: {
      steps: [
        {
          kind: "screenshot",
          caption: "Arabic account settings",
          review: { mode: "later" },
        },
      ],
    },
  };
  const planned = captureReviewQueueForRun(run);
  assert.equal(planned.items[0]?.status, "missing");
  assert.throws(
    () =>
      applyCaptureReviewDecision(run, {
        captureId: planned.items[0]!.captureId,
        action: "accept",
        actor: { id: "human:maria", kind: "human" },
      }),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_MISSING",
  );
});

test("agents cannot mark Looks correct", () => {
  assert.throws(
    () =>
      applyCaptureReviewDecision(
        { artifacts: [artifact], recipeSnapshot: { steps: [] } },
        {
          captureId: captureReviewId({
            caption: "Arabic account settings",
            framePath: "frames/001.png",
            imageSha256: "aaa",
          }),
          action: "accept",
          actor: { id: "agent:cursor", kind: "agent" },
        },
      ),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED",
  );
});

test("agent:cursor cannot impersonate a human Looks correct", () => {
  assert.throws(
    () =>
      applyCaptureReviewDecision(
        { artifacts: [artifact], recipeSnapshot: { steps: [] } },
        {
          captureId: captureReviewId({
            caption: "Arabic account settings",
            framePath: "frames/001.png",
            imageSha256: "aaa",
          }),
          action: "accept",
          actor: { id: "agent:cursor", kind: "human" },
        },
      ),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED",
  );
});

test("Looks correct on attempt 1 cannot accept a missing recapture attempt 2", () => {
  const firstSlot = {
    checkpointId: "settings",
    stepId: "settings",
    attempt: 1,
    caption: "Settings",
  };
  const secondSlot = { ...firstSlot, attempt: 2 };
  const run = {
    artifacts: [
      {
        kind: "capture-review",
        capturedAt: 1,
        data: {
          caption: "Settings",
          framePath: "frames/001.png",
          imageSha256: "aaa",
          checkpointId: "settings",
          stepId: "settings",
          attempt: 1,
          slotId: captureReviewSlotId(firstSlot),
        },
      },
    ],
    recipeSnapshot: {
      steps: [
        {
          id: "settings",
          kind: "screenshot",
          caption: "Settings",
          review: { mode: "later" },
        },
      ],
    },
  };
  const missingArtifact = {
    kind: "capture-review",
    capturedAt: 2,
    data: {
      caption: "Settings",
      checkpointId: "settings",
      stepId: "settings",
      attempt: 2,
      slotId: captureReviewSlotId(secondSlot),
    },
  };
  const queue = captureReviewQueueForRun({
    ...run,
    artifacts: [...run.artifacts, missingArtifact],
  });
  assert.equal(queue.items.length, 2);
  const missing = queue.items.find((item) => item.attempt === 2);
  assert.equal(missing?.status, "missing");
  assert.throws(
    () =>
      applyCaptureReviewDecision(
        { ...run, artifacts: [...run.artifacts, missingArtifact] },
        {
          captureId: missing!.captureId,
          action: "accept",
          actor: { id: "human:maria", kind: "human" },
        },
      ),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_MISSING",
  );
});

test("a second human cannot overwrite another reviewer's saved decision or note", () => {
  const captureId = captureReviewId({
    caption: "Arabic account settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const run = {
    artifacts: [artifact],
    outcome: "passed" as const,
    recipeSnapshot: { steps: [] },
  };
  const first = applyCaptureReviewDecision(run, {
    captureId,
    action: "report-issue",
    actor: { id: "human:maria", kind: "human" },
    imageSha256: "aaa",
    note: "Save overlaps seats",
  });
  assert.equal(first.outcome, "passed");
  assert.equal(first.captureReviews[0]?.note, "Save overlaps seats");
  assert.equal(first.queue.items[0]?.note, "Save overlaps seats");
  assert.throws(
    () =>
      applyCaptureReviewDecision(
        { ...run, captureReviews: first.captureReviews },
        {
          captureId,
          action: "accept",
          actor: { id: "human:alex", kind: "human" },
          imageSha256: "aaa",
        },
      ),
    (error: unknown) =>
      error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_CONFLICT",
  );
  const retry = applyCaptureReviewDecision(
    { ...run, captureReviews: first.captureReviews },
    {
      captureId,
      action: "report-issue",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
    },
  );
  assert.equal(retry.outcome, "passed");
  assert.equal(retry.captureReviews[0]?.decidedBy.id, "human:maria");
  assert.equal(retry.captureReviews[0]?.note, "Save overlaps seats");
  assert.equal(retry.captureReviews.length, 1);
});

test("a delayed same-reviewer retry replays its receipt without reverting a newer decision", () => {
  const captureId = captureReviewId({
    caption: "Arabic account settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const run = {
    artifacts: [artifact],
    outcome: "passed" as const,
    recipeSnapshot: { steps: [] },
  };
  const first = applyCaptureReviewDecision(run, {
    captureId,
    action: "accept",
    actor: { id: "human:maria", kind: "human" },
    imageSha256: "aaa",
    requestId: "review-a",
    expectedReviewVersion: 0,
  });
  const second = applyCaptureReviewDecision(
    {
      ...run,
      captureReviews: first.captureReviews,
      captureReviewReceipts: first.captureReviewReceipts,
    },
    {
      captureId,
      action: "report-issue",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
      note: "Overlap found",
      requestId: "review-b",
      expectedReviewVersion: 1,
    },
  );
  const retry = applyCaptureReviewDecision(
    {
      ...run,
      captureReviews: second.captureReviews,
      captureReviewReceipts: second.captureReviewReceipts,
    },
    {
      captureId,
      action: "accept",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
      requestId: "review-a",
      expectedReviewVersion: 0,
    },
  );
  assert.equal(retry.changed, false);
  assert.equal(retry.decision.action, "accept");
  assert.equal(retry.captureReviews[0]?.action, "report-issue");
  assert.equal(retry.captureReviews[0]?.note, "Overlap found");
  assert.equal(retry.queue.items[0]?.status, "issue");
});

test("a same-reviewer revision requires the current review version", () => {
  const captureId = captureReviewId({
    caption: "Arabic account settings",
    framePath: "frames/001.png",
    imageSha256: "aaa",
  });
  const run = {
    artifacts: [artifact],
    outcome: "passed" as const,
    recipeSnapshot: { steps: [] },
  };
  const first = applyCaptureReviewDecision(run, {
    captureId,
    action: "report-issue",
    actor: { id: "human:maria", kind: "human" },
    imageSha256: "aaa",
    note: "Overlap found",
    expectedReviewVersion: 0,
  });

  assert.throws(
    () =>
      applyCaptureReviewDecision(
        { ...run, captureReviews: first.captureReviews },
        {
          captureId,
          action: "accept",
          actor: { id: "human:maria", kind: "human" },
          imageSha256: "aaa",
        },
      ),
    (error: unknown) =>
      error instanceof CaptureReviewError &&
      error.code === "CAPTURE_REVIEW_CONFLICT" &&
      /current review version/u.test(error.message),
  );

  const revised = applyCaptureReviewDecision(
    { ...run, captureReviews: first.captureReviews },
    {
      captureId,
      action: "accept",
      actor: { id: "human:maria", kind: "human" },
      imageSha256: "aaa",
      expectedReviewVersion: 1,
    },
  );
  assert.equal(revised.decision.action, "accept");
  assert.equal(revised.decision.reviewVersion, 2);
});

test("run capture review reads Combine cell child plannedSlots", () => {
  const queue = captureReviewQueueForRun({
    artifacts: [
      {
        kind: "app-map-combine-cell-execution-intent",
        capturedAt: 1,
        data: {
          child: {
            plan: {
              plannedSlots: [
                {
                  checkpointId: "settings",
                  caption: "Settings",
                  stepId: "settings",
                  attempt: 1,
                },
              ],
            },
          },
        },
      },
    ],
  });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.items[0]?.caption, "Settings");
});
