import type { ProductTestSummary } from "@relay/product/catalog";
import { unrecordedProductName } from "@relay/protocol";

/** Separate explicit unfinished work without treating a previous run as readiness. */
export function isTestDraft(test: ProductTestSummary): boolean {
  return test.stepCount === 0 || unrecordedProductName(test.name);
}

export function testLibraryName(test: ProductTestSummary): string {
  return isTestDraft(test)
    ? test.name.replace(/^(?:UNRECORDED|DRAFT)\b\s*[—–:-]?\s*/u, "") || test.name
    : test.name;
}

export function runTime(run: ProductTestSummary["recentRun"]): number {
  return run ? (run.finishedAt ?? run.startedAt ?? run.queuedAt) : 0;
}

export function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
