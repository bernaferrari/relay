import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveReviewCut,
  nextReviewSourceMs,
  reviewTimeToSourceMs,
  sourceTimeToReviewMs,
} from "./review-cut";

test("review cut keeps action context and collapses long idle intervals", () => {
  const cut = deriveReviewCut({
    sourceDurationMs: 20_000,
    sourceStartedAt: 1_000,
    steps: [
      { kind: "tap", startedAt: 1_000, finishedAt: 1_200 },
      { kind: "tap", startedAt: 15_000, finishedAt: 15_200 },
    ],
  });
  assert.ok(cut);
  assert.equal(cut.segments.length, 2);
  assert.ok(cut.skippedDurationMs > 8_000);
  assert.equal(reviewTimeToSourceMs(cut, 0), 0);
  assert.equal(nextReviewSourceMs(cut, cut.segments[0]!.endMs + 1), cut.segments[1]!.startMs);
});

test("review cut preserves explicit waits and screenshot context", () => {
  const cut = deriveReviewCut({
    sourceDurationMs: 18_000,
    sourceStartedAt: 0,
    steps: [
      { kind: "sleep", startedAt: 2_000, finishedAt: 8_000 },
      { kind: "tap", startedAt: 14_000, durationMs: 100, frames: [{ capturedAt: 14_500 }] },
    ],
  });
  assert.ok(cut);
  assert.ok(cut.segments[0]!.endMs >= 9_000);
  const original = 14_500;
  const review = sourceTimeToReviewMs(cut, original);
  assert.equal(reviewTimeToSourceMs(cut, review), original);
});

test("short or evidence-free recordings keep the original timeline", () => {
  assert.equal(deriveReviewCut({ sourceDurationMs: 2_000, steps: [] }), null);
  assert.equal(deriveReviewCut({ sourceDurationMs: 20_000, steps: [] }), null);
});
