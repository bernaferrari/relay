import type { ProductRunPhase, ProductRunSummary } from "@relay/product/catalog";

/** One Results row per Plan grid; standalone Test Runs stay addressable. */
export function collapsePlanResultRows(runs: readonly ProductRunSummary[]): ProductRunSummary[] {
  const seen = new Set<string>();
  const rows: ProductRunSummary[] = [];
  for (const run of runs) {
    if (!run.batchId) {
      rows.push(run);
      continue;
    }
    if (seen.has(run.batchId)) continue;
    seen.add(run.batchId);
    rows.push(
      planResultRow(
        run,
        runs.filter((item) => item.batchId === run.batchId),
      ),
    );
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
    ...(outcome ? { outcome } : {}),
    caseCount: count,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt !== undefined && startedAt !== undefined && finishedAt >= startedAt
      ? { durationMs: finishedAt - startedAt }
      : {}),
  };
}

function planResultListTitle(run: ProductRunSummary): string {
  const fromJob = run.title.split(" · ")[0]?.trim();
  if (fromJob && fromJob !== run.title && fromJob !== "Run Across") return fromJob;
  return `${run.appName ?? "Plan"} Result`;
}

function planResultPhase(siblings: readonly ProductRunSummary[]): ProductRunPhase {
  if (siblings.some((item) => item.phase === "running")) return "running";
  if (siblings.some((item) => item.phase === "queued")) return "queued";
  if (siblings.some((item) => item.phase === "failed")) return "failed";
  if (siblings.some((item) => item.phase === "cancelled")) return "cancelled";
  return "completed";
}

function planResultOutcome(
  siblings: readonly ProductRunSummary[],
  phase: ProductRunPhase,
): ProductRunSummary["outcome"] {
  if (siblings.some((item) => item.outcome === "product-failure")) return "product-failure";
  if (siblings.some((item) => item.outcome === "harness-failure")) return "harness-failure";
  if (siblings.some((item) => item.outcome === "uncertain" || item.review?.status === "pending")) {
    return "uncertain";
  }
  if (phase === "completed" && siblings.every((item) => item.outcome === "passed")) return "passed";
  return undefined;
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
