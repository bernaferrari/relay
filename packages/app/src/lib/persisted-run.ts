import type { JobInfo, PersistedRun } from "../context/server";

export function persistedAsJob(run: PersistedRun): JobInfo {
  const status = ["queued", "running", "paused", "ok", "error", "healed", "cancelled"].includes(
    run.status,
  )
    ? (run.status as JobInfo["status"])
    : "error";
  return {
    ...run,
    persisted: true,
    status,
    queuedAt: run.queuedAt ?? run.startedAt ?? run.writtenAt,
    logs: run.logs ?? [],
    steps: run.steps ?? [],
    frames: run.frames ?? [],
    attempts: run.attempts ?? 1,
  };
}
