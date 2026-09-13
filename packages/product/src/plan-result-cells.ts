import type { CombineEvidenceFindingCode } from "@relay/protocol";
import {
  classifyPlanResultCell,
  planResultCellLabel as canonicalPlanResultCellLabel,
  summarizePlanResult,
  type PlanResultCellKind,
  type PlanResultSummary,
} from "@relay/protocol";
import type { ProductBatchCase } from "./run-across.js";

export type ProductResultCellKind = PlanResultCellKind;

export function planResultColumnIdentity(item: {
  targetProfileId: string;
  targetLabel?: string;
  account?:
    | {
        kind: "fixture";
        accountId: string;
        accountRevision: string;
        accountLabel?: string;
      }
    | { kind: "signed-out"; attested: true };
}): { environmentId: string; environmentLabel: string } {
  const device = item.targetLabel?.trim() || item.targetProfileId;
  if (!item.account) {
    return { environmentId: item.targetProfileId, environmentLabel: device };
  }
  if (item.account.kind === "signed-out") {
    return {
      environmentId: `${item.targetProfileId}#signed-out`,
      environmentLabel: `Logged out · ${device}`,
    };
  }
  const account = item.account.accountLabel?.trim() || item.account.accountId;
  return {
    environmentId: `${item.targetProfileId}#${item.account.accountId}:${item.account.accountRevision}`,
    environmentLabel: `${account} · ${device}`,
  };
}

export function classifyProductResultCell(item: ProductBatchCase): ProductResultCellKind {
  return classifyPlanResultCell({
    status: item.status,
    ...(item.findingCode ? { findingCode: item.findingCode } : {}),
    ...(item.failureCategory ? { failureCategory: item.failureCategory } : {}),
    ...(item.outcome ? { outcome: item.outcome } : {}),
  });
}

export function productResultCellLabel(kind: ProductResultCellKind): string {
  return canonicalPlanResultCellLabel(kind);
}

export type ProductResultGridSummary = PlanResultSummary & {
  readonly passed: number;
  readonly failed: number;
  readonly needEyes: number;
  readonly productTotal: number;
  readonly productPassRate: number | undefined;
};

export function summarizeProductResultGrid(
  cases: readonly ProductBatchCase[],
): ProductResultGridSummary {
  const grid = summarizePlanResult(
    cases.map((item) => ({
      status: item.status,
      ...(item.findingCode ? { findingCode: item.findingCode } : {}),
      ...(item.failureCategory ? { failureCategory: item.failureCategory } : {}),
      ...(item.outcome ? { outcome: item.outcome } : {}),
    })),
  );
  const productTotal = grid.checks.passed + grid.checks.failed + grid.checks.needsReview;
  return {
    ...grid,
    passed: grid.cells.passed,
    failed: grid.cells["check-failed"],
    needEyes: grid.checks.needsReview + grid.checks.failed,
    productTotal,
    productPassRate: undefined,
  };
}

export function resultFindingCode(item: ProductBatchCase): CombineEvidenceFindingCode | undefined {
  return item.findingCode;
}
