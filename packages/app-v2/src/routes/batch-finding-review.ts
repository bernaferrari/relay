import type { CombineEvidenceAnalysisReport, CombineEvidenceFinding } from "@relay/protocol";

/** Job id for Report → Review screenshots. Never an accept action. */
export function findingScreenshotRunId(
  finding: CombineEvidenceFinding,
  report: CombineEvidenceAnalysisReport,
): string | undefined {
  if (finding.canonicalKey.startsWith("job:")) {
    const jobId = finding.canonicalKey.slice("job:".length).trim();
    if (jobId) return jobId;
  }
  return report.cases.find((item) => item.jobId && finding.id.includes(item.jobId))?.jobId;
}
