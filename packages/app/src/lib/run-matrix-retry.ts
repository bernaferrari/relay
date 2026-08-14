import type { RunMatrixReview } from "./run-matrix-review";
import { currentLocaleRetry } from "./run-matrix-review";

type RetryActions = {
  runCurrent: (input: {
    appMapId: string;
    combineId: string;
    selected: Record<string, string[]>;
    title: string;
  }) => Promise<string | null>;
  retryFrozen: (jobId: string) => Promise<void>;
};

export type MatrixRetryResult = {
  kind: "current-locales" | "frozen-runs";
  count: number;
};

export function matrixRetryToast(result: MatrixRetryResult): string {
  return result.kind === "current-locales"
    ? "Recompiled the current Test and queued only problem locales; passing results were kept"
    : `Queued only ${result.count} problem ${result.count === 1 ? "cell" : "cells"}; passing results were kept`;
}

export async function retryProblemMatrix(
  review: RunMatrixReview,
  actions: RetryActions,
): Promise<MatrixRetryResult | null> {
  const problems = review.rows.filter(
    (row) => row.missingCaptures > 0 || ["error", "cancelled"].includes(row.job.status),
  );
  if (!problems.length) return null;
  const currentRetry = currentLocaleRetry(review);
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
