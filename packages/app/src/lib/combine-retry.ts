import type { CombineReview } from "./combine-review";
import { currentLocaleCombineRetry } from "./combine-review";

type RetryActions = {
  runCurrent: (input: {
    appMapId: string;
    testId: string;
    variableIds: string[];
    selected: Record<string, string[]>;
    title: string;
  }) => Promise<string | { jobId: string | null; campaignId?: string } | null>;
  retryFrozen: (jobId: string) => Promise<void>;
};

export type CombineRetryResult = {
  kind: "current-locales" | "frozen-runs";
  count: number;
};

export function combineRetryToast(result: CombineRetryResult): string {
  return result.kind === "current-locales"
    ? "Recompiled the current Test and queued only problem locales; passing results were kept"
    : `Queued only ${result.count} problem ${result.count === 1 ? "cell" : "cells"}; passing results were kept`;
}

export async function retryProblemCombine(
  review: CombineReview,
  actions: RetryActions,
): Promise<CombineRetryResult | null> {
  const problems = review.rows.filter(
    (row) => row.missingCaptures > 0 || ["error", "cancelled"].includes(row.job.status),
  );
  if (!problems.length) return null;
  const currentRetry = currentLocaleCombineRetry(review);
  if (currentRetry) {
    const nextBatch = await actions.runCurrent({
      ...currentRetry,
      title: `Retry ${problems.length} problem ${problems.length === 1 ? "locale" : "locales"}`,
    });
    return nextBatch ? { kind: "current-locales", count: problems.length } : null;
  }
  for (const row of problems) await actions.retryFrozen(row.job.id);
  return { kind: "frozen-runs", count: problems.length };
}
