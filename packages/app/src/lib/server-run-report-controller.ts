import type { Setter } from "solid-js";
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
import type { JobInfo, PersistedRun, RunEvidenceQuery } from "./api-types";

type Request = <T = unknown>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;
type RunAction = <Id extends OperationId>(
  operationId: Id,
  input: OperationInput<Id>,
) => Promise<OperationOutput<Id>>;

export function createServerRunReportController(input: {
  request: Request;
  runAction: RunAction;
  setJobs: Setter<JobInfo[]>;
  setPersistedRuns: Setter<PersistedRun[]>;
  refreshRuns: () => Promise<void>;
}) {
  async function loadRunDetail(id: string): Promise<void> {
    try {
      const live = await input.request<{ job: JobInfo }>(`/jobs/${encodeURIComponent(id)}`);
      if (live.job) {
        input.setJobs((current) => current.map((job) => (job.id === id ? live.job : job)));
        return;
      }
    } catch {
      /* completed jobs may only exist in persisted storage after restart */
    }
    try {
      const data = await input.request<{ run: PersistedRun }>(`/runs/${encodeURIComponent(id)}`);
      if (!data.run) return;
      input.setPersistedRuns((current) => {
        const exists = current.some((run) => run.id === id);
        return exists
          ? current.map((run) => (run.id === id ? data.run : run))
          : [data.run, ...current];
      });
    } catch {
      return;
    }
  }

  async function loadRunSignals(id: string): Promise<RegressionSignal[]> {
    try {
      const data = await input.request<{ signals?: RegressionSignal[] }>(
        `/runs/${encodeURIComponent(id)}/signals`,
      );
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
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.includeBodies) query.set("includeBodies", "true");
      const suffix = query.size ? `?${query.toString()}` : "";
      const data = await input.request<{ evidence?: RunEvidenceQuery }>(
        `/runs/${encodeURIComponent(id)}/evidence${suffix}`,
      );
      return data.evidence ?? null;
    } catch {
      return null;
    }
  }

  async function compareVisualRun(id: string): Promise<VisualComparison | null> {
    try {
      return (await input.runAction("run.visual.compare", { runId: id })).comparison;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
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
      toast(error instanceof Error ? error.message : String(error), "error");
      return null;
    }
  }

  async function reviewRun(
    id: string,
    action: "approve" | "reject",
    note?: string,
  ): Promise<RunReview | null> {
    try {
      const result = await input.runAction("run.review", {
        runId: id,
        action,
        ...(note?.trim() ? { note: note.trim() } : {}),
      });
      await input.refreshRuns();
      await loadRunDetail(id);
      return result.review;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
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
