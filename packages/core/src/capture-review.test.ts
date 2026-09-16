import assert from "node:assert/strict";
import test from "node:test";
import { captureReviewId } from "@relay/protocol";
import { applyCaptureReviewDecision, CaptureReviewError } from "./capture-review.js";

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

test("a missing screenshot stays missing and cannot be accepted", () => {
  assert.throws(
    () =>
      applyCaptureReviewDecision(
        {
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
        },
        {
          captureId: captureReviewId({ caption: "Arabic account settings" }),
          action: "accept",
          actor: { id: "human:maria", kind: "human" },
        },
      ),
    (error: unknown) => error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_MISSING",
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
