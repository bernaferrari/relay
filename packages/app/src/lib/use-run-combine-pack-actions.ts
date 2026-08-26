import type { Accessor } from "solid-js";
import type { JobInfo } from "./api-types";
import type { CombineReview } from "./combine-review";
import { combineRetryToast, retryProblemCombine } from "./combine-retry";
import { toast } from "../context/toast";
import { humanError } from "./human-error";

/** The three things a person can do to a Combine pack as a whole: retry only the
 * cells that went wrong, export its screenshots, or stop what is still queued. */
export function useCombinePackActions(input: {
  review: Accessor<CombineReview | null>;
  rows: Accessor<JobInfo[]>;
  exporting: Accessor<boolean>;
  setExporting: (value: boolean) => void;
  runPathAcrossVariables: Parameters<typeof retryProblemCombine>[1]["runCurrent"];
  retryFrozen: Parameters<typeof retryProblemCombine>[1]["retryFrozen"];
  exportEvidence: (batchId: string) => Promise<{ rootDir: string }>;
  cancelJob: (id: string) => Promise<unknown>;
}): {
  retryProblems: () => Promise<void>;
  exportPack: () => Promise<void>;
  stopPending: () => Promise<void>;
} {
  const retryProblems = async () => {
    const review = input.review();
    if (!review) return;
    const result = await retryProblemCombine(review, {
      runCurrent: input.runPathAcrossVariables,
      retryFrozen: input.retryFrozen,
    });
    if (!result) return;
    toast(combineRetryToast(result), "success");
  };

  const exportPack = async () => {
    const batchId = input.review()?.batchId;
    if (!batchId || input.exporting()) return;
    input.setExporting(true);
    try {
      const exported = await input.exportEvidence(batchId);
      await navigator.clipboard?.writeText(exported.rootDir);
      toast("Screenshot pack exported · folder path copied", "success");
    } catch (error) {
      toast(humanError(error, "Could not export this screenshot pack"), "error");
    } finally {
      input.setExporting(false);
    }
  };

  const stopPending = async () => {
    const pending = input
      .rows()
      .filter((job) => ["queued", "running", "paused"].includes(job.status));
    for (const job of pending) await input.cancelJob(job.id);
  };

  return { retryProblems, exportPack, stopPending };
}
