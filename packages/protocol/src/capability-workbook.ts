import {
  evaluateWorkbookCoverage,
  type WorkbookCatalogTest,
  type WorkbookCoverageManifest,
  type WorkbookCoverageReport,
} from "./workbook-coverage.js";

export type WorkbookCompileAttempt = {
  testId: string;
  errorCode: string;
};

/**
 * Compile unresolved-step / Unbound never deletes the original from the
 * remaining-before-gates denominator and never counts as coverage.
 */
export function workbookCoverageAfterCompileAttempts(
  manifest: WorkbookCoverageManifest,
  catalog: readonly WorkbookCatalogTest[] = [],
  attempts: readonly WorkbookCompileAttempt[] = [],
): WorkbookCoverageReport {
  void attempts;
  return evaluateWorkbookCoverage(manifest, catalog);
}
