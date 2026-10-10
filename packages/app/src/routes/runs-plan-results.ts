import type { ProductRunPhase, ProductRunSummary } from "@relay/product/catalog";
import { summarizePlanResult, type PlanResultCase } from "@relay/protocol";

/** One Results row per Plan grid; standalone Test Runs stay addressable. */
export function collapsePlanResultRows(runs: readonly ProductRunSummary[]): ProductRunSummary[] {
  const groups = new Map<string, ProductRunSummary[]>();
  for (const run of runs) {
    if (!run.batchId) continue;
    const group = groups.get(run.batchId) ?? [];
    group.push(run);
    groups.set(run.batchId, group);
  }
  const seen = new Set<string>();
  const rows: ProductRunSummary[] = [];
  for (const run of runs) {
    if (!run.batchId) {
      rows.push(run);
      continue;
    }
    if (seen.has(run.batchId)) continue;
    seen.add(run.batchId);
    rows.push(planResultRow(run, groups.get(run.batchId)!));
  }
  return rows;
}

export function resultRowHref(run: ProductRunSummary): string {
  return run.batchId ? `/batches/${run.batchId}` : `/runs/${run.id}`;
}

function planResultRow(
  representative: ProductRunSummary,
  siblings: readonly ProductRunSummary[],
): ProductRunSummary {
  const count = representative.caseCount ?? siblings.length;
  const phase = planResultPhase(siblings);
  const outcome = planResultOutcome(siblings, phase);
  const finishedAt = newest(siblings.map((item) => item.finishedAt));
  const startedAt = oldest(siblings.map((item) => item.startedAt ?? item.queuedAt));
  return {
    ...representative,
    title: planResultListTitle(representative),
    phase,
    outcome,
    captureSummary: combineCaptureSummaries(siblings),
    caseCount: count,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt !== undefined && startedAt !== undefined && finishedAt >= startedAt
      ? { durationMs: finishedAt - startedAt }
      : {}),
  };
}

function planResultListTitle(run: ProductRunSummary): string {
  const fromJob = run.title.split(" ·")[0]?.trim();
  if (fromJob && fromJob !== run.title && fromJob !== "Run Across") return fromJob;
  return `${run.appName ?? "Plan"} Result`;
}

function planResultPhase(siblings: readonly ProductRunSummary[]): ProductRunPhase {
  const grid = summarizePlanRuns(siblings);
  if (grid.cells.running) return "running";
  if (grid.cells.pending) return "queued";
  if (grid.cells["check-failed"] || grid.cells["could-not-run"]) return "failed";
  if (grid.cells.cancelled) return "cancelled";
  return "completed";
}

function planResultOutcome(
  siblings: readonly ProductRunSummary[],
  phase: ProductRunPhase,
): ProductRunSummary["outcome"] {
  const grid = summarizePlanRuns(siblings);
  if (grid.cells["check-failed"]) return "product-failure";
  if (grid.cells["could-not-run"]) return "harness-failure";
  if (grid.cells["needs-review"]) return "uncertain";
  if (phase === "completed" && grid.cells.passed === grid.coverage.planned) return "passed";
  if (phase === "cancelled" && grid.cells.cancelled === grid.coverage.planned) return "cancelled";
  return undefined;
}

function summarizePlanRuns(siblings: readonly ProductRunSummary[]) {
  return summarizePlanResult(siblings.map(planResultCase));
}

function planResultCase(run: ProductRunSummary): PlanResultCase {
  const status = run.outcome === "passed" ? "passed" : run.phase;
  const reviewRequired = run.outcome === "uncertain" || run.review?.status === "pending";
  return {
    status,
    ...(reviewRequired ? { failureCategory: "review-required" } : {}),
    ...(run.outcome ? { outcome: run.outcome } : {}),
  };
}

/** Results list copy. A failed phase is not a product pass when the cell is Infra. */
export function planResultListCause(run: ProductRunSummary): string | undefined {
  if (run.outcome === "product-failure") return "Failed";
  if (run.outcome === "harness-failure") return "Could not complete";
  if (run.review?.status === "pending" || run.outcome === "uncertain") return "Needs review";
  if (run.phase === "queued") return "Waiting to start";
  if (run.phase === "running") return "In progress";
  if (run.phase === "cancelled") return "Cancelled";
  if (run.phase === "failed") return "Could not complete";
  return undefined;
}

function newest(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length ? Math.max(...present) : undefined;
}

function oldest(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length ? Math.min(...present) : undefined;
}

function combineCaptureSummaries(
  runs: readonly ProductRunSummary[],
): ProductRunSummary["captureSummary"] {
  if (runs.some((run) => !run.captureSummary)) return undefined;
  const total = { captured: 0, missing: 0, pending: 0, accepted: 0, issue: 0, needMoreEvidence: 0 };
  for (const run of runs) {
    for (const key of Object.keys(total) as (keyof typeof total)[])
      total[key] += run.captureSummary![key];
  }
  return total;
}

export function screenshotReviewLabel(
  summary: ProductRunSummary["captureSummary"],
): string | undefined {
  if (!summary || summary.captured + summary.missing === 0) return undefined;
  const parts: string[] = [];
  if (summary.pending) parts.push(`${summary.pending} to review`);
  if (summary.missing) parts.push(`${summary.missing} not captured`);
  if (summary.issue) parts.push(`${summary.issue} ${summary.issue === 1 ? "issue" : "issues"}`);
  if (summary.needMoreEvidence) parts.push(`${summary.needMoreEvidence} need more evidence`);
  return parts.length ? parts.join(" · ") : `${summary.accepted} approved`;
}

export function hasScreenshotReviewAttention(run: ProductRunSummary): boolean {
  const summary = run.captureSummary;
  return Boolean(
    summary && (summary.pending || summary.missing || summary.issue || summary.needMoreEvidence),
  );
}
