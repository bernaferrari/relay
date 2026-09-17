import type { CombineEvidenceFindingCode } from "./combine-evidence-contract.js";

/** One Plan cell as classified from typed findings, never error-string regex. */
export type PlanResultCase = {
  status: string;
  findingCode?: CombineEvidenceFindingCode;
  failureCategory?: string;
  outcome?: string;
};

export type PlanResultCellKind =
  | "passed"
  | "check-failed"
  | "needs-review"
  | "could-not-run"
  | "running"
  | "cancelled"
  | "pending";

export type PlanResultFacts = {
  readonly execution: {
    readonly passed: number;
    readonly blocked: number;
    readonly cancelled: number;
    readonly running: number;
    readonly pending: number;
  };
  readonly checks: {
    readonly passed: number;
    readonly failed: number;
    readonly needsReview: number;
  };
  readonly coverage: {
    readonly verified: number;
    readonly planned: number;
  };
};

export type PlanResultSummary = PlanResultFacts & {
  readonly cells: Record<PlanResultCellKind, number>;
  readonly headline: string;
  readonly detail: string;
  readonly action?: string;
  readonly executionLine: string;
  readonly checksLine: string;
  readonly coverageLine: string;
};

const HARNESS_FINDINGS = new Set<CombineEvidenceFindingCode>([
  "HARNESS_FAILURE",
  "ACCOUNT_NEEDS_RELOGIN",
  "BLOCKED",
]);

const REVIEW_FINDINGS = new Set<CombineEvidenceFindingCode>([
  "VISUAL_CHANGED",
  "JUDGE_UNCERTAIN",
  "MANUAL_CHECKPOINT",
]);

export function classifyPlanResultCell(item: PlanResultCase): PlanResultCellKind {
  if (item.status === "pending" || item.status === "queued") return "pending";
  if (item.status === "running") return "running";
  if (item.status === "passed") return "passed";
  if (item.findingCode && HARNESS_FINDINGS.has(item.findingCode)) return "could-not-run";
  if (item.status === "blocked") return "could-not-run";
  if (item.findingCode && REVIEW_FINDINGS.has(item.findingCode)) return "needs-review";
  if (item.failureCategory === "visual-assertion") return "needs-review";
  if (item.failureCategory === "judge-uncertainty") return "needs-review";
  if (item.failureCategory === "review-required") return "needs-review";
  if (item.findingCode === "USER_CANCELLED" || item.status === "cancelled") return "cancelled";
  if (item.findingCode === "PRODUCT_ASSERTION") return "check-failed";
  if (item.failureCategory === "deterministic-assertion") return "check-failed";
  if (item.failureCategory === "semantic-assertion") return "check-failed";
  if (item.outcome === "product-failure") return "check-failed";
  if (item.outcome === "harness-failure") return "could-not-run";
  if (item.status === "failed") return "check-failed";
  return "could-not-run";
}

export function planResultCellLabel(kind: PlanResultCellKind): string {
  if (kind === "passed") return "Passed";
  if (kind === "check-failed") return "Check failed";
  if (kind === "needs-review") return "Needs review";
  if (kind === "could-not-run") return "Could not run";
  if (kind === "running") return "Running";
  if (kind === "cancelled") return "Cancelled";
  return "Waiting";
}

function counted(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function summarizePlanResult(cases: readonly PlanResultCase[]): PlanResultSummary {
  const cells: Record<PlanResultCellKind, number> = {
    passed: 0,
    "check-failed": 0,
    "needs-review": 0,
    "could-not-run": 0,
    running: 0,
    cancelled: 0,
    pending: 0,
  };
  for (const item of cases) cells[classifyPlanResultCell(item)] += 1;
  const planned = cases.length;
  const verified = cells.passed;
  const blockedCount = cases.filter(
    (item) => item.status === "blocked" || item.findingCode === "BLOCKED",
  ).length;
  const facts: PlanResultFacts = {
    execution: {
      passed: cells.passed,
      blocked: blockedCount,
      cancelled: cells.cancelled,
      running: cells.running,
      pending: cells.pending,
    },
    checks: {
      passed: cells.passed,
      failed: cells["check-failed"],
      needsReview: cells["needs-review"],
    },
    coverage: { verified, planned },
  };
  const executionParts = [
    counted(facts.execution.passed, "passed", "passed"),
    facts.execution.blocked ? counted(facts.execution.blocked, "blocked", "blocked") : undefined,
    facts.execution.cancelled
      ? counted(facts.execution.cancelled, "cancelled", "cancelled")
      : undefined,
    cells["check-failed"]
      ? counted(cells["check-failed"], "check failed", "check failed")
      : undefined,
    cells["needs-review"]
      ? counted(cells["needs-review"], "needs review", "need review")
      : undefined,
    facts.execution.running ? counted(facts.execution.running, "running", "running") : undefined,
    facts.execution.pending ? counted(facts.execution.pending, "waiting", "waiting") : undefined,
  ].filter((part): part is string => Boolean(part));
  const executionLine = executionParts.join(", ");
  const checksLine = `${counted(facts.checks.passed, "passed", "passed")}${
    facts.checks.failed ? `, ${counted(facts.checks.failed, "check failed", "check failed")}` : ""
  }${facts.checks.needsReview ? `, ${counted(facts.checks.needsReview, "needs review", "need review")}` : ""}`;
  const coverageLine = `${verified} of ${planned} planned cases verified`;
  return {
    ...facts,
    cells,
    headline: resultHeadline(facts, cells),
    detail: executionLine,
    ...(facts.execution.blocked ? { action: "Resolve blockers" } : {}),
    executionLine,
    checksLine,
    coverageLine,
  };
}

function resultHeadline(facts: PlanResultFacts, cells: Record<PlanResultCellKind, number>): string {
  const { planned, verified } = facts.coverage;
  if (planned === 0) return "No cases were run";
  if (cells.cancelled === planned) return "Plan was cancelled";
  if (facts.execution.blocked === planned) return "All selected cases are blocked";
  if (verified === planned && cells["check-failed"] === 0 && cells["needs-review"] === 0) {
    return "All selected cases passed";
  }
  if (verified < planned) {
    return `Incomplete — ${verified} of ${planned} planned cases verified`;
  }
  if (cells.running || cells.pending) return "Plan is still in progress";
  if (cells["needs-review"] || cells["check-failed"]) {
    return `${counted(cells["check-failed"], "check failed", "check failed")}, ${counted(cells["needs-review"], "needs review", "need review")}`;
  }
  return `Incomplete — ${verified} of ${planned} planned cases verified`;
}

/** Map Combine analysis cells onto Plan summary cases using typed finding ids. */
export function planResultCasesFromFindings(input: {
  cases: readonly { jobId: string; status: string }[];
  findings: readonly { id: string; canonicalKey: string; code: CombineEvidenceFindingCode }[];
}): PlanResultCase[] {
  return input.cases.map((item) => {
    const finding = input.findings.find(
      (entry) =>
        entry.canonicalKey === `job:${item.jobId}` ||
        entry.id === `harness-failure-${item.jobId}` ||
        entry.id === `product-assertion-${item.jobId}` ||
        entry.id === `judge-uncertain-${item.jobId}` ||
        entry.id === `user-cancelled-${item.jobId}` ||
        entry.id === `blocked-${item.jobId}`,
    );
    return {
      status: item.status,
      ...(finding ? { findingCode: finding.code } : {}),
    };
  });
}

/** Honest Plan summary for `--findings` markdown. Never a 100% product pass on harness. */
export function planFindingsSummaryLines(input: {
  cases: readonly { jobId: string; status: string }[];
  findings: readonly { id: string; canonicalKey: string; code: CombineEvidenceFindingCode }[];
}): readonly string[] {
  const grid = summarizePlanResult(planResultCasesFromFindings(input));
  const lines = [`**Plan summary:** ${grid.headline}`, grid.detail];
  if (
    grid.coverage.planned > 0 &&
    grid.cells.passed < grid.coverage.planned &&
    grid.checks.failed === 0 &&
    (grid.cells["could-not-run"] > 0 || grid.cells.cancelled > 0)
  ) {
    lines.push("Incomplete / harness — not a product pass.");
  }
  return lines;
}
