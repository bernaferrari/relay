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

/**
 * Compact relative time for a finished job: "now" / "Nm" / "Nh" / "Nd".
 * Returns "" when there's no finish timestamp (running/queued/idle).
 */
export function fmtAgo(finishedAt?: number, now: number = Date.now()): string {
  if (!finishedAt) return "";
  const s = Math.max(0, Math.round((now - finishedAt) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Compact millisecond formatting for a single step/action: 423ms / 1.2s / 1m4s. */
export function fmtMs(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms < 1) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

/** Pluralize a count + noun: n(1, "frame") → "1 frame", n(2, "step") → "2 steps". */
export function n(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A known recipe/action id → title, for resolving slugs at render sites. */
export type TitledId = { id: string; title: string };

/**
 * Resolve a recipe/action id to a display title. Prefers a known recipe title
 * (passed in by callers that have server context — lib/job stays pure); falls
 * back to turning the slug into words, capitalizing only the first word:
 * "update-last-alpha" → "Update last alpha". Internal ids never reach body copy.
 */
export function titleize(id: string, known?: Iterable<TitledId>): string {
  if (known) {
    for (const r of known) {
      if (r.id === id) return r.title;
    }
  }
  const words = id.replace(/[-_]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return id;
  words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1);
  return words.join(" ");
}
