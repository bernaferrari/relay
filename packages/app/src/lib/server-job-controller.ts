import type { Accessor, Setter } from "solid-js";
import type { RelayClient } from "@relay/client";
import type { JobInfo, LogLine, PersistedRun } from "./api-types";
import { createCoalescedRefresh } from "./coalesced-refresh";
import { refreshFailure, type RefreshOutcome } from "./refresh-outcome";

export function createServerJobController(input: {
  client: () => Promise<RelayClient>;
  health: Accessor<"unknown" | "online" | "offline">;
  jobs: Accessor<JobInfo[]>;
  setJobs: Setter<JobInfo[]>;
  persistedRuns: Accessor<PersistedRun[]>;
  setPersistedRuns: Setter<PersistedRun[]>;
  setRunning: Setter<boolean>;
  selectedJobId: Accessor<string | null>;
  appendLog: (text: string, level?: LogLine["level"], jobId?: string) => void;
}) {
  const coalescedRefreshJobs = createCoalescedRefresh(async (): Promise<RefreshOutcome> => {
    try {
      const data = await (await input.client()).invoke("job.list", {});
      // job.list is still registered with the summary DTO while the server
      // includes the richer active-job projection used by the workbench.
      const list = data.jobs as unknown as JobInfo[];
      const active = data.active as unknown as JobInfo | null | undefined;
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
      const data = await (
        await input.client()
      ).invoke("run.list", {
        limit: appMapId ? 200 : 40,
        ...(appMapId ? { appMapId } : {}),
      });
      // run.list currently declares summary DTOs while this state also keeps
      // detail fields previously loaded through run.get.
      const list = data.runs as unknown as PersistedRun[];
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
