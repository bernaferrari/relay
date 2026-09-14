import type { CombineEvidenceAnalysisReport, CombineEvidenceFinding } from "@relay/protocol";
import { emptyPlanFindingsReport, type PlanFindingDecision } from "@relay/product/plan-findings";
import type { ProductBatchReport } from "@relay/product/run-across";
import { notesForCase, type BatchReviewNote } from "../data/batch-review-notes";
import {
  formatBatchTestLabel,
  formatBatchWorldLabel,
  type BatchTestNames,
} from "./batch-result-view";

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

/** Prefer analyzed Findings. If analysis is missing, surface typed cell codes
 * so a cancelled SOS still has Confirm/Reject. Empty remains a QA gap. */
export function resolvePlanFindings(
  report: ProductBatchReport,
  analysis?: CombineEvidenceAnalysisReport,
  testNames: BatchTestNames = {},
): CombineEvidenceAnalysisReport {
  if (analysis?.analysis.findings.length) return analysis;
  const derived = planFindingsFromBatch(report, testNames);
  if (derived.analysis.findings.length) return derived;
  return emptyPlanFindingsReport(report.id);
}

export function planFindingsFromBatch(
  report: ProductBatchReport,
  testNames: BatchTestNames = {},
): CombineEvidenceAnalysisReport {
  const findings: CombineEvidenceFinding[] = [];
  for (const item of report.cases) {
    const code = item.findingCode;
    if (!code) continue;
    if (item.status !== "failed" && item.status !== "blocked" && item.status !== "cancelled") {
      continue;
    }
    const jobId = item.runId?.trim();
    const testId = item.identity?.testId;
    findings.push({
      id: `cell-${item.id}`,
      code,
      severity: "critical",
      confidence: "high",
      canonicalKey: jobId ? `job:${jobId}` : item.id,
      screenLabel: testId
        ? formatBatchTestLabel(testId, testNames[testId])
        : item.world
          ? formatBatchWorldLabel(item.world)
          : formatBatchTestLabel(item.id),
      locale: item.world?.trim() || "en",
      baselineLocale: "en",
      detail: item.error?.trim() || "This case did not finish.",
    });
  }
  const critical = findings.length;
  return {
    schemaVersion: 1,
    batchId: report.id,
    locales: [...new Set(findings.map((item) => item.locale))],
    analysis: {
      schemaVersion: 1,
      sessionId: report.id,
      generatedAt: report.updatedAt,
      baselineLocale: "en",
      findings,
      critical,
      warnings: 0,
      affectedScreens: findings.length ? findings.length : 0,
    },
    coverage: { frames: 0, inspectedFrames: 0 },
    cases: report.cases.flatMap((item) =>
      item.runId
        ? [
            {
              jobId: item.runId,
              locale: item.world?.trim() || "en",
              status: item.status,
              frames: [],
            },
          ]
        : [],
    ),
  };
}
