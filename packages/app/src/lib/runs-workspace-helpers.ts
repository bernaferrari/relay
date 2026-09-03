import type { JobInfo } from "../context/server";
import { runOutcomeChip } from "../components/status-chip";

export type RunFilterId = "all" | "passed" | "attention" | "review" | "active";

export type RunBatchSummary = {
  title: string;
  count: number;
  passed: number;
  attention: number;
  active: number;
  durationMs: number;
  status: string;
  tone: "pass" | "attention" | "active";
};

function sharedBatchTitle(rows: JobInfo[]): string {
  const titles = rows.map((row) => row.title?.trim()).filter(Boolean) as string[];
  if (!titles.length) return "Repeat";
  const segments = titles.map((title) => title.split(" · "));
  const shared: string[] = [];
  for (let index = 0; index < segments[0]!.length; index += 1) {
    const value = segments[0]![index];
    if (!segments.every((parts) => parts[index] === value)) break;
    shared.push(value!);
  }
  if (shared.at(-1)?.toLocaleLowerCase() === "across") shared.pop();
  return shared.join(" · ") || titles[0]!;
}

/** Present one matrix execution as one result, while retaining every cell for review. */
export function summarizeRunBatch(row: JobInfo, allRows: JobInfo[]): RunBatchSummary | null {
  if (!row.batchId) return null;
  const rows = allRows.filter((candidate) => candidate.batchId === row.batchId);
  if (rows.length < 2) return null;
  const passed = rows.filter((candidate) => runOutcomeChip(candidate).tone === "pass").length;
  const active = rows.filter((candidate) =>
    ["queued", "running", "paused"].includes(candidate.status),
  ).length;
  const attention = rows.length - passed - active;
  return {
    title: sharedBatchTitle(rows),
    count: rows.length,
    passed,
    attention,
    active,
    durationMs: rows.reduce(
      (total, candidate) =>
        total +
        (candidate.durationMs ??
          Math.max(
            0,
            (candidate.finishedAt ?? candidate.startedAt ?? candidate.queuedAt) -
              (candidate.startedAt ?? candidate.queuedAt),
          )),
      0,
    ),
    status: active
      ? `${active} active · ${passed + attention} of ${rows.length} complete`
      : attention
        ? `${passed} passed · ${attention} need attention`
        : `All ${passed} passed`,
    tone: active ? "active" : attention ? "attention" : "pass",
  };
}

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
      (a.steps?.length ?? 0) === (b.steps?.length ?? 0) &&
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
  ["all", "Latest results"],
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
