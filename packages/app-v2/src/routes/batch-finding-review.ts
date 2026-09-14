import type { CombineEvidenceAnalysisReport, CombineEvidenceFinding } from "@relay/protocol";
import type { PlanFindingDecision } from "@relay/product/plan-findings";
import { notesForCase, type BatchReviewNote } from "../data/batch-review-notes";

export function findingNoteCaseId(findingId: string): string {
  return `finding:${findingId}`;
}

export function findingDecisionFromNote(text: string): PlanFindingDecision | undefined {
  if (text.startsWith("confirm:")) return "confirm";
  if (text.startsWith("reject:")) return "reject";
  return undefined;
}

export function latestFindingDecision(
  notes: readonly BatchReviewNote[],
  findingId: string,
): PlanFindingDecision | undefined {
  const last = notesForCase(notes, findingNoteCaseId(findingId)).at(-1);
  return last ? findingDecisionFromNote(last.text) : undefined;
}

export function latestFindingNote(
  notes: readonly BatchReviewNote[],
  findingId: string,
): BatchReviewNote | undefined {
  return notesForCase(notes, findingNoteCaseId(findingId)).at(-1);
}

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
