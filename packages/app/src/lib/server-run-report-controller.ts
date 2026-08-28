import type { Setter } from "solid-js";
import type { RelayClient } from "@relay/client";
import type {
  OperationId,
  OperationInput,
  OperationOutput,
  RegressionSignal,
  RunReview,
  RunShareCreateResult,
  RunShareSummary,
  VisualComparison,
  VisualReviewAction,
  VisualReviewDecision,
} from "@relay/protocol";
import { toast } from "../context/toast";
import { humanError } from "./human-error";
import type { JobInfo, PersistedRun, RunEvidenceQuery } from "./api-types";

type RunAction = <Id extends OperationId>(
  operationId: Id,
  input: OperationInput<Id>,
) => Promise<OperationOutput<Id>>;

export function createServerRunReportController(input: {
  client: () => Promise<RelayClient>;
  runAction: RunAction;
  setJobs: Setter<JobInfo[]>;
  setPersistedRuns: Setter<PersistedRun[]>;
  refreshRuns: () => Promise<void>;
}) {
  async function loadPersistedRun(id: string): Promise<boolean> {
    try {
      const data = await input.runAction("run.get", { runId: id });
      const run = data.run as PersistedRun;
      input.setPersistedRuns((current) => {
        const exists = current.some((run) => run.id === id);
        return exists
          ? current.map((currentRun) => (currentRun.id === id ? run : currentRun))
          : [run, ...current];
      });
      return true;
    } catch {
      return false;
    }
  }

  async function loadLiveJob(id: string): Promise<boolean> {
    try {
      const live = await input.runAction("job.get", { jobId: id });
      const job = live.job as JobInfo;
      input.setJobs((current) =>
        current.map((currentJob) => (currentJob.id === id ? job : currentJob)),
      );
      return true;
    } catch {
      return false;
    }
  }

  async function loadRunDetail(id: string, persisted = false): Promise<void> {
    // History rows already tell us where the run lives. Asking /jobs first for
    // every completed run produced a visible 404 before loading the real
    // artifact, which made ordinary evidence review look broken.
    if (persisted) {
      if (await loadPersistedRun(id)) return;
      await loadLiveJob(id);
      return;
    }
    if (await loadLiveJob(id)) return;
    await loadPersistedRun(id);
  }

  async function loadRunSignals(id: string): Promise<RegressionSignal[]> {
    try {
      const data = await (
        await input.client()
      ).resource<{ signals?: RegressionSignal[] }>(`/runs/${encodeURIComponent(id)}/signals`);
      return data.signals ?? [];
    } catch {
      return [];
    }
  }

  async function loadRunEvidence(
    id: string,
    options: { limit?: number; includeBodies?: boolean } = {},
  ): Promise<RunEvidenceQuery | null> {
    try {
      const data = await input.runAction("run.evidence.get", {
        runId: id,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.includeBodies ? { includeBodies: true } : {}),
      });
      return data.evidence as RunEvidenceQuery;
    } catch {
      return null;
    }
  }

  async function compareVisualRun(id: string): Promise<VisualComparison | null> {
    try {
      return (await input.runAction("run.visual.compare", { runId: id })).comparison;
    } catch (error) {
      toast(humanError(error, "Could not compare this run's screenshots"), "error");
      return null;
    }
  }

  async function reviewVisualRun(
    id: string,
    comparisonId: string,
    action: VisualReviewAction,
    note?: string,
  ): Promise<VisualReviewDecision | null> {
    try {
      return (
        await input.runAction("run.visual.review", {
          runId: id,
          comparisonId,
          action,
          ...(note?.trim() ? { note: note.trim() } : {}),
        })
      ).decision;
    } catch (error) {
      toast(humanError(error, "Could not record this visual review"), "error");
      return null;
    }
  }

  async function reviewRun(
    id: string,
    action: "approve" | "reject" | "defer",
    note?: string,
  ): Promise<RunReview | null> {
    try {
      const result = await input.runAction("run.review", {
        runId: id,
        action,
        ...(note?.trim() ? { note: note.trim() } : {}),
      });
      await input.refreshRuns();
      await loadRunDetail(id, true);
      return result.review;
    } catch (error) {
      toast(humanError(error, "Could not record this review"), "error");
      return null;
    }
  }

  async function listRunShares(runId: string): Promise<RunShareSummary[]> {
    return (await input.runAction("run.share.list", { runId })).shares;
  }

  function createRunShare(
    runId: string,
    expiresInHours: number,
    includeBatch: boolean,
  ): Promise<RunShareCreateResult> {
    return input.runAction("run.share.create", { runId, expiresInHours, includeBatch });
  }

  async function revokeRunShare(runId: string, shareId: string): Promise<RunShareSummary> {
    return (await input.runAction("run.share.revoke", { runId, shareId })).share;
  }

  return {
    loadRunDetail,
    loadRunSignals,
    loadRunEvidence,
    compareVisualRun,
    reviewVisualRun,
    reviewRun,
    listRunShares,
    createRunShare,
    revokeRunShare,
  };
}
