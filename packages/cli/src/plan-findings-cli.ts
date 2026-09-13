import type { CombineEvidenceAnalysisReport } from "@relay/protocol";

/** Pull a Plan findings report off a fail-closed combine.start error. */
export function planFindingsReportFromError(
  details: unknown,
): CombineEvidenceAnalysisReport | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const findings = (details as { findings?: unknown }).findings;
  if (!findings || typeof findings !== "object" || Array.isArray(findings)) return undefined;
  const report = findings as CombineEvidenceAnalysisReport;
  if (report.schemaVersion !== 1 || typeof report.batchId !== "string") return undefined;
  if (!report.analysis || !Array.isArray(report.analysis.findings)) return undefined;
  return report;
}
