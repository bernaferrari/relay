import type { ProductBatchCase } from "./run-across.js";

export function planResultColumnIdentity(item: {
  targetProfileId: string;
  account?:
    | { kind: "fixture"; accountId: string; accountRevision: string }
    | { kind: "signed-out"; attested: true };
}): { environmentId: string; environmentLabel: string } {
  if (!item.account) {
    return { environmentId: item.targetProfileId, environmentLabel: item.targetProfileId };
  }
  if (item.account.kind === "signed-out") {
    return {
      environmentId: `${item.targetProfileId}#signed-out`,
      environmentLabel: "Logged out",
    };
  }
  return {
    environmentId: `${item.targetProfileId}#${item.account.accountId}:${item.account.accountRevision}`,
    environmentLabel: item.account.accountId,
  };
}

export type ProductResultCellKind =
  | "passed"
  | "failed"
  | "infra"
  | "changed"
  | "judged"
  | "manual"
  | "pending"
  | "running"
  | "stopped";

export type ProductResultGridSummary = {
  readonly passed: number;
  readonly failed: number;
  readonly infra: number;
  readonly changed: number;
  readonly judged: number;
  readonly manual: number;
  readonly pending: number;
  readonly running: number;
  readonly stopped: number;
  readonly needEyes: number;
  readonly productTotal: number;
  readonly productPassRate: number | undefined;
  readonly headline: string;
  readonly detail: string;
};

const INFRA_PATTERN =
  /harness|xctest|uiautomation|lease|session expired|device not found|not connected|target-state|environment|could not complete|no active session|needs re-login|needs-relogin|account_needs_relogin|open sign-ins|unsupported_platform|no recorded/iu;
const CHANGED_PATTERN = /visual_changed|visual difference|visual-assertion|visual changed/iu;
const JUDGED_PATTERN =
  /judge uncertain|judge-uncertainty|semantic-assertion|evaluate-semantic|evaluate-visual|uncertain/iu;
const MANUAL_PATTERN = /pause|manual checkpoint|awaiting a person|human checkpoint/iu;

export function classifyProductResultCell(item: ProductBatchCase): ProductResultCellKind {
  if (item.status === "pending" || item.status === "queued") return "pending";
  if (item.status === "running") return "running";
  if (item.status === "passed") return "passed";
  if (item.status === "cancelled") return "stopped";
  if (item.status === "blocked") return "infra";
  const error = item.error ?? "";
  if (MANUAL_PATTERN.test(error)) return "manual";
  if (CHANGED_PATTERN.test(error)) return "changed";
  if (JUDGED_PATTERN.test(error)) return "judged";
  if (INFRA_PATTERN.test(error)) return "infra";
  return "failed";
}

export function productResultCellLabel(kind: ProductResultCellKind): string {
  if (kind === "passed") return "Passed";
  if (kind === "failed") return "Failed";
  if (kind === "infra") return "Infra";
  if (kind === "changed") return "Changed";
  if (kind === "judged") return "Judged";
  if (kind === "manual") return "Manual";
  if (kind === "pending") return "Waiting";
  if (kind === "running") return "Running";
  return "Stopped";
}

export function summarizeProductResultGrid(
  cases: readonly ProductBatchCase[],
): ProductResultGridSummary {
  const counts = {
    passed: 0,
    failed: 0,
    infra: 0,
    changed: 0,
    judged: 0,
    manual: 0,
    pending: 0,
    running: 0,
    stopped: 0,
  };
  for (const item of cases) counts[classifyProductResultCell(item)] += 1;
  const needEyes = counts.changed + counts.failed + counts.judged + counts.manual;
  const productTotal =
    counts.passed + counts.failed + counts.changed + counts.judged + counts.manual;
  const productPassRate = productTotal ? counts.passed / productTotal : undefined;
  return {
    ...counts,
    needEyes,
    productTotal,
    productPassRate,
    headline: resultHeadline(counts, needEyes, cases.length),
    detail: resultDetail(counts, needEyes, productTotal, productPassRate),
  };
}

function resultHeadline(
  counts: Omit<
    ProductResultGridSummary,
    "needEyes" | "productTotal" | "productPassRate" | "headline" | "detail"
  >,
  needEyes: number,
  total: number,
): string {
  if (total === 0) return "No cases were run";
  if (counts.stopped === total) return "Plan was cancelled";
  if (counts.infra === total) return "All selected cases are blocked";
  if (counts.passed === total) return "All selected cases passed";
  if (needEyes)
    return `${counts.changed} changed, ${counts.failed} failed, ${needEyes} need your eyes`;
  if (counts.running || counts.pending) return "Plan is still in progress";
  return "Plan completed";
}

function resultDetail(
  counts: Omit<
    ProductResultGridSummary,
    "needEyes" | "productTotal" | "productPassRate" | "headline" | "detail"
  >,
  needEyes: number,
  productTotal: number,
  productPassRate: number | undefined,
): string {
  const remaining = counts.pending + counts.running;
  const pass =
    productPassRate === undefined
      ? "product pass rate unreported"
      : `${Math.round(productPassRate * 100)}% product pass rate`;
  return `${counts.passed} passed · ${counts.failed} failed · ${counts.infra} infra · ${counts.changed} changed · ${counts.judged} judged · ${counts.manual} manual · ${counts.stopped} cancelled · ${remaining} remaining · ${needEyes} need your eyes · ${productTotal} product cases · ${pass}`;
}
