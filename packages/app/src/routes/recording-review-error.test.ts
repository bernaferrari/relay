import { describe, expect, it } from "vitest";
import { ApiError } from "@relay/client";
import {
  recordingReviewDiagnostics,
  recordingReviewErrorCopy,
  reviewRequestProblem,
  reviewTransitionConfirmed,
} from "./recording-review-error";
import type { ProductRecordingState } from "../data/recording-product-service";

function recordedResult(): ProductRecordingState {
  return {
    status: "reviewing",
    targets: [],
    snapshot: {
      schemaVersion: 1,
      kind: "author-test",
      title: "Test",
      phase: "running",
      stage: "reviewing",
      version: "v7",
      workflow: { workflowId: "workflow", expectedVersion: 7 },
      authoring: { sessionId: "session" },
      progress: { label: "Review" },
      allowedNextActions: ["inspect", "edit", "replay"],
      problems: [],
      evidenceRefs: [],
      review: {
        actionCount: 0,
        actions: [],
        currentRevision: 3,
        replayRequired: false,
        latestReplay: { id: "replay", takeRevision: 3, outcome: "passed" },
      },
    },
  };
}

describe("recording action confirmation", () => {
  it("requires matching successful replay identity and revision", () => {
    const result = recordedResult();
    const canonical = structuredClone(result);
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(true);
    canonical.snapshot!.review!.latestReplay!.id = "older-replay";
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(false);
    canonical.snapshot!.review!.latestReplay!.id = "replay";
    canonical.snapshot!.review!.currentRevision = 4;
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(false);
  });

  it("cannot acknowledge failure, uncertainty, a foreign owner, or an unavailable read", () => {
    const result = recordedResult();
    const canonical = structuredClone(result);
    Object.assign(result, {
      recovery: {
        code: "mutation-outcome-unknown",
        title: "Unknown",
        detail: "",
        recovery: "Inspect",
        retryable: false,
      },
    });
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(false);
    Object.assign(result, { recovery: undefined });
    result.snapshot!.review!.latestReplay!.outcome = "failed";
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(false);
    result.snapshot!.review!.latestReplay!.outcome = "passed";
    canonical.snapshot!.workflow!.workflowId = "foreign";
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(false);
    canonical.snapshot!.workflow!.workflowId = "workflow";
    canonical.snapshot!.authoring!.sessionId = "foreign-session";
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(false);
    canonical.snapshot!.authoring!.sessionId = "session";
    canonical.snapshot!.version = "unavailable";
    expect(reviewTransitionConfirmed(result, canonical, { action: "replay" })).toBe(false);
  });

  it("requires exact edit revision or the exact committed Test", () => {
    const result = recordedResult();
    const canonical = structuredClone(result);
    expect(
      reviewTransitionConfirmed(result, canonical, {
        action: "edit",
        edit: { kind: "clip", fromMs: 0 },
      }),
    ).toBe(true);
    canonical.snapshot!.review!.currentRevision = 4;
    expect(
      reviewTransitionConfirmed(result, canonical, {
        action: "edit",
        edit: { kind: "clip", fromMs: 0 },
      }),
    ).toBe(false);
    result.snapshot!.stage = canonical.snapshot!.stage = "committed";
    result.snapshot!.authoring!.committedTestId = "test";
    canonical.snapshot!.authoring!.committedTestId = "other";
    expect(
      reviewTransitionConfirmed(result, canonical, { action: "approve", testName: "Test" }),
    ).toBe(false);
    canonical.snapshot!.authoring!.committedTestId = "test";
    expect(
      reviewTransitionConfirmed(result, canonical, { action: "approve", testName: "Test" }),
    ).toBe(true);
  });
});

it("does not fabricate code, request correlation, or HTTP status for an arbitrary exception", () => {
  expect(recordingReviewDiagnostics("edit", new Error("private stack and token"))).toEqual([
    "Operation: Update recorded steps",
  ]);
  expect(
    recordingReviewDiagnostics(
      "inspect",
      new ApiError(999, "private", { code: "private-token", requestId: "private" }),
    ),
  ).toEqual(["Operation: Check recording status"]);
});

it("retains bounded read response status and leaves mutation confirmation copy unchanged", () => {
  const recovery = { code: "operation-unavailable", httpStatus: 503 };
  expect(recordingReviewDiagnostics("inspect", undefined, recovery)).toEqual([
    "Operation: Check recording status",
    "HTTP status: 503",
    "Code: operation-unavailable",
  ]);
  expect(recordingReviewErrorCopy("inspect", undefined, undefined, recovery)).toEqual({
    title: "Recording status is temporarily unavailable",
    detail: "Relay could not complete this status check.",
    recovery: "Wait a moment, then check status.",
  });
  expect(recordingReviewErrorCopy("replay", undefined, undefined, recovery)).toEqual({
    title: "Could not confirm the replay",
    detail: "Check status before choosing your next action.",
    recovery: "",
  });
  const specific = {
    title: "Saved setup needs review",
    detail: "Review the captured setup.",
    recovery: "Open the Test.",
  };
  expect(
    recordingReviewErrorCopy("inspect", specific, undefined, {
      ...recovery,
      sourceCode: "target-profile-ambiguous",
    }),
  ).toEqual(specific);
  for (const httpStatus of [0, 999, 503.5, Number.NaN]) {
    expect(recordingReviewDiagnostics("inspect", undefined, { httpStatus })).toEqual([
      "Operation: Check recording status",
    ]);
    expect(recordingReviewErrorCopy("inspect", undefined, undefined, { httpStatus })?.title).toBe(
      "Could not load the recording",
    );
  }
});

it("attributes status reads and mutation failures to their actual operation", () => {
  const error = new Error("private");
  expect(
    reviewRequestProblem({
      transition: { error, variables: { action: "edit", edit: { kind: "clip" } } },
    }),
  ).toEqual({ error, reviewOperation: "edit" });
  expect(
    reviewRequestProblem({
      inspectionError: error,
      transition: { error: undefined, variables: { action: "replay" } },
    }),
  ).toEqual({ error, reviewOperation: "inspect" });
  expect(reviewRequestProblem({ draftError: error })).toEqual({
    error,
    reviewOperation: "save-draft",
  });
});
