import type { JobInfo } from "../context/server";
import { runOutcomeChip } from "../components/status-chip";

export type RunFilterId = "all" | "passed" | "attention" | "review" | "active";

/** Filter run rows by the history toolbar chip. */
export function filterRunRows(rows: JobInfo[], filter: RunFilterId): JobInfo[] {
  if (filter === "passed") {
    return rows.filter((row) => runOutcomeChip(row).tone === "pass");
  }
  if (filter === "attention") {
    return rows.filter((row) => runOutcomeChip(row).tone === "fail");
  }
  if (filter === "review") {
    return rows.filter(
      (row) => row.review?.status === "pending" || (row.outcome === "uncertain" && !row.review),
    );
  }
  if (filter === "active") {
    return rows.filter((row) => ["queued", "running", "paused"].includes(row.status));
  }
  return rows;
}

/**
 * Default history view collapses to one row per flow so the list answers
 * "what needs review?" instead of repeating the same flow many times.
 */
export function dedupeLatestRunFlows(rows: JobInfo[]): JobInfo[] {
  const seenFlows = new Set<string>();
  return rows.filter((row) => {
    const key = row.action || row.title || row.id;
    if (seenFlows.has(key)) return false;
    seenFlows.add(key);
    return true;
  });
}

/**
 * Stable equality for the selected run across background poll churn.
 * `rows()` re-spreads persisted runs into fresh objects even when nothing
 * meaningful changed; comparing identity fields keeps the report panels mounted.
 */
export function runsEqualForSelection(a: JobInfo | null, b: JobInfo | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.id === b.id &&
      a.status === b.status &&
      (a.finishedAt ?? 0) === (b.finishedAt ?? 0) &&
      ((a as { writtenAt?: number }).writtenAt ?? 0) ===
        ((b as { writtenAt?: number }).writtenAt ?? 0) &&
      (a.artifacts?.length ?? 0) === (b.artifacts?.length ?? 0) &&
      (a.frames?.length ?? 0) === (b.frames?.length ?? 0) &&
      a.review?.status === b.review?.status &&
      (a.review?.decidedAt ?? 0) === (b.review?.decidedAt ?? 0))
  );
}

export function evidenceTabForChannel(
  channel: string,
): "network" | "performance" | "logs" | "evaluation" {
  if (channel === "network") return "network";
  if (channel === "performance") return "performance";
  if (channel === "log") return "logs";
  return "evaluation";
}

export function findBaselineRun(rows: JobInfo[], current: JobInfo): JobInfo | null {
  return (
    rows.find(
      (row) =>
        row.id !== current.id &&
        row.action === current.action &&
        (row.finishedAt ?? row.startedAt ?? row.queuedAt) <
          (current.finishedAt ?? current.startedAt ?? current.queuedAt),
    ) ?? null
  );
}

export const RUN_FILTER_TABS = [
  ["all", "Latest"],
  ["review", "Review"],
  ["passed", "Passed"],
  ["attention", "Attention"],
  ["active", "Active"],
] as const satisfies ReadonlyArray<readonly [RunFilterId, string]>;

export const RUN_REPORT_TABS = [
  ["timeline", "Steps"],
  ["summary", "Summary"],
  ["visual", "Visual"],
  ["evaluation", "Checks"],
  ["network", "Network"],
  ["logs", "Logs"],
  ["performance", "Metrics"],
] as const;
