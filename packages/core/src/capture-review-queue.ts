import {
  resolveCaptureReviewQueue,
  type CaptureReviewPlannedSlot,
  type CaptureReviewQueue,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import { executionIntentPlannedSlots } from "./run-test-step-evidence.js";

export type CaptureReviewRun = Pick<PersistedRun, "artifacts" | "captureReviews"> & {
  recipeSnapshot?: {
    steps?: readonly unknown[];
    recipes?: Record<string, { steps?: readonly unknown[] }>;
  };
  recipeGraph?: Record<string, { steps?: readonly unknown[] }>;
};

function plannedSlotsForRun(
  run: CaptureReviewRun,
): readonly CaptureReviewPlannedSlot[] | undefined {
  return executionIntentPlannedSlots(run.artifacts ?? []);
}

export function captureReviewQueueForRun(run: CaptureReviewRun): CaptureReviewQueue {
  return resolveCaptureReviewQueue({
    artifacts: run.artifacts,
    decisions: run.captureReviews,
    recipeSteps: run.recipeSnapshot?.steps,
    recipes: run.recipeGraph ?? run.recipeSnapshot?.recipes,
    plannedSlots: plannedSlotsForRun(run),
  });
}
