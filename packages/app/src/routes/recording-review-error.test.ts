import { describe, expect, it } from "vitest";
import { ApiError } from "@relay/client";
import {
  recordingReviewDiagnostics,
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
