import type { JobInfo } from "../context/server";

/** Map a job/run status to a UI tone token used by `tone--*` / `nav-row__dot--*`. */
export function statusTone(status: JobInfo["status"] | "idle"): string {
  if (status === "ok") return "pass";
  if (status === "healed") return "heal";
  if (status === "error" || status === "cancelled") return "fail";
  if (status === "paused") return "heal";
  if (status === "running" || status === "queued") return "run";
  return "dim";
}

/**
 * Human-readable run duration. `now` lets callers drive re-render cadence
 * (e.g. a ticking clock signal) so a running job's timer doesn't freeze;
 * it defaults to Date.now() for finished/idle jobs.
 */
export function fmtDur(job: JobInfo, now: number = Date.now()): string {
  const end = job.finishedAt ?? (job.status === "running" ? now : (job.startedAt ?? job.queuedAt));
  const start = job.startedAt ?? job.queuedAt;
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
