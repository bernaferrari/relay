import { captureReviewQueueItemKey } from "@relay/protocol";
import type { RunAcrossProductService } from "../data/run-across-product-service";

type ReviewResponse = Awaited<ReturnType<NonNullable<RunAcrossProductService["reviewCaptures"]>>>;

/** Only an exact, unambiguous acknowledgement clears a selected screenshot. */
export function captureReviewFeedback(
  requested: readonly { runId: string; captureId: string }[],
  results: ReviewResponse["results"],
) {
  const savedKeys: string[] = [];
  const failures: { key: string; message: string; status?: string }[] = [];
  const messages = {
    missing: "The screenshot is missing. Collect new evidence before reviewing it.",
    "not-found": "This screenshot is no longer in the review queue. Refresh screenshots.",
    conflict: "The screenshot or its review changed. Refresh before deciding again.",
    "actor-required": "A signed-in human reviewer must save this decision.",
  };
  for (const item of requested) {
    const key = captureReviewQueueItemKey(item);
    const matches = results.filter((result) => captureReviewQueueItemKey(result) === key);
    const result = matches.length === 1 ? matches[0] : undefined;
    if (result?.status === "applied") savedKeys.push(key);
    else
      failures.push({
        key,
        ...(result ? { status: result.status } : {}),
        message: result
          ? result.error || messages[result.status as keyof typeof messages]
          : "Save was not confirmed. Refresh before retrying.",
      });
  }
  return { savedKeys, failures };
}
