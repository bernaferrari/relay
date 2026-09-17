import type { CombineEvidenceFinding } from "./combine-evidence-contract.js";

/** Durable Test id on a finding. Screen labels are display text, never identity. */
export function planFindingTestId(finding: CombineEvidenceFinding): string | undefined {
  const testId = finding.testId?.trim();
  return testId || undefined;
}

/**
 * A finding is flaky only when its Test id is in a comparable Stability
 * cohort. Missing identity is not flaky and cannot be hidden.
 */
export function planFindingIsFlaky(
  finding: CombineEvidenceFinding,
  flakyTestIds: ReadonlySet<string>,
): boolean {
  const testId = planFindingTestId(finding);
  return Boolean(testId && flakyTestIds.has(testId));
}

export type PlanFindingFlakyView = {
  /** Display-only. Never skips the next run or accepts a visual baseline. */
  readonly hideFlaky: boolean;
  readonly flakyTestIds: ReadonlySet<string>;
};

/** Flaky-labelled items sort to the bottom. Hide is a view filter, not a skip. */
export function visiblePlanFindings(
  findings: readonly CombineEvidenceFinding[],
  view: PlanFindingFlakyView,
): CombineEvidenceFinding[] {
  const ranked = [...findings].sort((left, right) => {
    const leftFlaky = planFindingIsFlaky(left, view.flakyTestIds) ? 1 : 0;
    const rightFlaky = planFindingIsFlaky(right, view.flakyTestIds) ? 1 : 0;
    return leftFlaky - rightFlaky;
  });
  if (!view.hideFlaky) return ranked;
  return ranked.filter((finding) => !planFindingIsFlaky(finding, view.flakyTestIds));
}
