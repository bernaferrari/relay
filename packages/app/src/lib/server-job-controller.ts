import type { Accessor, Setter } from "solid-js";
import type { RelayClient } from "@relay/client";
import type { JobInfo, LogLine, PersistedRun } from "./api-types";
import { asArray } from "./api";
import { createCoalescedRefresh } from "./coalesced-refresh";
import { refreshFailure, type RefreshOutcome } from "./refresh-outcome";

type Request = <T = unknown>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;

export function createServerJobController(input: {
  request: Request;
  client: () => Promise<RelayClient>;
  health: Accessor<"unknown" | "online" | "offline">;
  jobs: Accessor<JobInfo[]>;
  setJobs: Setter<JobInfo[]>;
  persistedRuns: Accessor<PersistedRun[]>;
  setPersistedRuns: Setter<PersistedRun[]>;
  setRunsRoot: Setter<string>;
  setRunning: Setter<boolean>;
  selectedJobId: Accessor<string | null>;
  appendLog: (text: string, level?: LogLine["level"], jobId?: string) => void;
}) {
  const coalescedRefreshJobs = createCoalescedRefresh(async (): Promise<RefreshOutcome> => {
    try {
      const data = await input.request<{ jobs: JobInfo[]; active: JobInfo | null }>("/jobs");
      const list = asArray<JobInfo>(data, "jobs");
      const active = data.active;
      input.setJobs((current) => {
        const detailed = new Map(
          current
            .filter((job) => job.recipeSnapshot || job.artifacts?.length || job.steps?.length)
            .map((job) => [job.id, job]),
        );
        return list.map((summary) => {
          if (active?.id === summary.id) return active;
          const richer = detailed.get(summary.id);
          return richer ? { ...richer, ...summary } : summary;
        });
      });
      input.setRunning(
        Boolean(active && (active.status === "running" || active.status === "paused")),
      );
      return { ok: true };
    } catch (error) {
      return refreshFailure(error);
    }
  });

  function refreshJobs(): Promise<RefreshOutcome> {
    if (input.health() === "offline") return Promise.resolve(refreshFailure("Relay is offline"));
    return coalescedRefreshJobs();
  }

  async function refreshRuns(appMapId?: string): Promise<RefreshOutcome> {
    if (input.health() === "offline") return refreshFailure("Relay is offline");
    try {
      const query = new URLSearchParams({ limit: appMapId ? "200" : "40" });
      if (appMapId) query.set("appMapId", appMapId);
      const data = await input.request<{ runs: PersistedRun[]; root: string }>(`/runs?${query}`);
      const list = asArray<PersistedRun>(data, "runs");
      // Preserve details enriched by loadRunDetail across catalog-only refreshes.
      input.setPersistedRuns((current) => {
        const detailed = new Map(
          current.filter((run) => run.steps?.length).map((run) => [run.id, run]),
        );
        const projected = list.map((incoming) => {
          const richer = detailed.get(incoming.id);
          return richer && !incoming.steps?.length
            ? {
                ...incoming,
                steps: richer.steps,
                frames: richer.frames,
                artifacts: richer.artifacts,
              }
            : incoming;
        });
        if (!appMapId) return projected;
        const byId = new Map(current.map((run) => [run.id, run]));
        for (const run of projected) byId.set(run.id, run);
        return [...byId.values()].sort((left, right) => right.writtenAt - left.writtenAt);
      });
      input.setRunsRoot(data.root ?? "");
      return { ok: true };
    } catch (error) {
      return refreshFailure(error);
    }
  }

  async function cancelJob(jobId?: string): Promise<void> {
    const id = jobId ?? input.selectedJobId() ?? undefined;
    try {
      const client = await input.client();
      if (id) await client.invoke("job.cancel", { jobId: id });
      else await client.invoke("job.active.cancel", {});
      input.appendLog("cancel requested", "info", id);
      void refreshJobs();
    } catch (error) {
      input.appendLog(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function pauseJob(jobId?: string): Promise<void> {
    const id = jobId ?? input.selectedJobId();
    if (!id) {
      input.appendLog("No job to pause", "error");
      return;
    }
    try {
      await (await input.client()).invoke("job.pause", { jobId: id });
      input.appendLog("paused", "info", id);
      void refreshJobs();
    } catch (error) {
      input.appendLog(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function resumeJob(jobId?: string): Promise<void> {
    const id = jobId ?? input.selectedJobId();
    if (!id) {
      input.appendLog("No job to resume", "error");
      return;
    }
    try {
      await (await input.client()).invoke("job.resume", { jobId: id });
      input.appendLog("resumed", "info", id);
      void refreshJobs();
    } catch (error) {
      input.appendLog(error instanceof Error ? error.message : String(error), "error");
    }
  }

  const activeJob = () =>
    input.jobs().find((job) => job.status === "running" || job.status === "paused") ?? null;
  const isPaused = () => activeJob()?.status === "paused";
  // Jobs are newest-first; queued display order is execution order.
  const queuedJobs = () =>
    input
      .jobs()
      .filter((job) => job.status === "queued")
      .reverse();

  return {
    refreshJobs,
    refreshRuns,
    cancelJob,
    pauseJob,
    resumeJob,
    activeJob,
    isPaused,
    queuedJobs,
  };
}
