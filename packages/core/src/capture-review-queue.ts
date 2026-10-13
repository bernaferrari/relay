import {
  resolveCaptureReviewQueue,
  type CaptureReviewPlannedSlot,
  type CaptureReviewQueue,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import { executionIntentPlannedSlots } from "./run-test-step-evidence.js";

export type CaptureReviewRun = Pick<
  PersistedRun,
  "artifacts" | "captureReviews" | "captureReviewReceipts" | "captureComparisons"
> &
  Partial<Pick<PersistedRun, "outcome" | "referenceReviewMode">> & {
    recipeSnapshot?: {
      steps?: readonly unknown[];
      recipes?: Record<string, { steps?: readonly unknown[] }>;
    };
    recipeGraph?: Record<string, { steps?: readonly unknown[] }>;
  };

/** Note shown on a first screenshot accepted because its run passed. */
export const FIRST_CAPTURE_ON_PASS_NOTE = "No reference yet; accepted with a passing run.";

function plannedSlotsForRun(
  run: CaptureReviewRun,
): readonly CaptureReviewPlannedSlot[] | undefined {
  return executionIntentPlannedSlots(run.artifacts ?? []);
}

/** Reads frozen decisions and reference comparisons; never enrolls an image on read. */
export function captureReviewQueueForRun(run: CaptureReviewRun): CaptureReviewQueue {
  return resolveCaptureReviewQueue({
    artifacts: run.artifacts,
    decisions: run.captureReviews,
    ...(run.captureComparisons ? { comparisons: run.captureComparisons } : {}),
    recipeSteps: run.recipeSnapshot?.steps,
    recipes: run.recipeGraph ?? run.recipeSnapshot?.recipes,
    plannedSlots: plannedSlotsForRun(run),
  });
}
