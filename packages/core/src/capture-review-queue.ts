import {
  CAPTURE_REFERENCE_ACTOR,
  resolveCaptureReviewQueue,
  summarizeCaptureReview,
  type CaptureReviewItem,
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

/**
 * The default review policy, applied when the queue is read: on a passing run
 * a screenshot with no reference yet is accepted, exactly as
 * `applyCaptureReferences` does for runs that finish today. Runs recorded
 * before that policy (never compared, so no reference state at all) read the
 * same way, so counts, the review inbox and `relay review` agree. A Plan that
 * asks for human review keeps every screenshot in the person's queue.
 */
function acceptedByPassingRun(run: CaptureReviewRun, item: CaptureReviewItem): boolean {
  if (item.status !== "pending" || run.outcome !== "passed") return false;
  if ((run.referenceReviewMode ?? "approved-reference") !== "approved-reference") return false;
  if (item.reference) return item.reference.state === "new";
  // Compared runs record every comparable screenshot; a missing entry there
  // means the comparison failed, which stays with a person.
  return run.captureComparisons === undefined && Boolean(item.framePath);
}

export function captureReviewQueueForRun(run: CaptureReviewRun): CaptureReviewQueue {
  const queue = resolveCaptureReviewQueue({
    artifacts: run.artifacts,
    decisions: run.captureReviews,
    ...(run.captureComparisons ? { comparisons: run.captureComparisons } : {}),
    recipeSteps: run.recipeSnapshot?.steps,
    recipes: run.recipeGraph ?? run.recipeSnapshot?.recipes,
    plannedSlots: plannedSlotsForRun(run),
  });
  if (!queue.items.some((item) => acceptedByPassingRun(run, item))) return queue;
  const items = queue.items.map((item) =>
    acceptedByPassingRun(run, item)
      ? {
          ...item,
          status: "accepted" as const,
          decidedBy: { ...CAPTURE_REFERENCE_ACTOR },
          note: FIRST_CAPTURE_ON_PASS_NOTE,
        }
      : item,
  );
  return { items, summary: summarizeCaptureReview(items) };
}
