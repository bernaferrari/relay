import type { CombineEvidenceAnalysisReport, CombineEvidenceFinding } from "@relay/protocol";
import { emptyPlanFindingsReport, type PlanFindingDecision } from "@relay/product/plan-findings";
import type { ProductBatchCase, ProductBatchReport } from "@relay/product/run-across";
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

function jobIdFromFinding(finding: CombineEvidenceFinding): string | undefined {
  if (!finding.canonicalKey.startsWith("job:")) return undefined;
  const jobId = finding.canonicalKey.slice("job:".length).trim();
  return jobId || undefined;
}

/** Copy durable Test identity from the Result cell. Never invent from a label. */
export function attachPlanFindingTestId(
  finding: CombineEvidenceFinding,
  cases: readonly ProductBatchCase[],
): CombineEvidenceFinding {
  if (finding.testId?.trim()) return finding;
  const jobId = jobIdFromFinding(finding);
  if (!jobId) return finding;
  const match = cases.find((item) => item.runId === jobId);
  const testId = match?.identity?.testId?.trim();
  return testId ? { ...finding, testId } : finding;
}

export type PlanFindingsAnalysisState = "pending" | "incomplete" | "failed" | "complete";

export function planFindingsAnalysisState(
  report: ProductBatchReport,
  analysis?: CombineEvidenceAnalysisReport,
): PlanFindingsAnalysisState {
  if (!analysis) return "pending";
  if (analysis.batchId !== report.id) return "failed";
  if (
    analysis.coverage.frames > 0 &&
    analysis.coverage.inspectedFrames < analysis.coverage.frames
  ) {
    return "incomplete";
  }
  return "complete";
}

function findingIdentity(finding: CombineEvidenceFinding): string {
  if (finding.stableKey?.trim()) return finding.stableKey.trim();
  return finding.id;
}

function mergePlanFindings(
  derived: CombineEvidenceAnalysisReport,
  analysis: CombineEvidenceAnalysisReport,
): CombineEvidenceAnalysisReport {
  const byId = new Map<string, CombineEvidenceFinding>();
  const jobsWithActual = new Set<string>();
  for (const finding of analysis.analysis.findings) {
    byId.set(findingIdentity(finding), finding);
    if (finding.canonicalKey.startsWith("job:")) jobsWithActual.add(finding.canonicalKey);
  }
  for (const finding of derived.analysis.findings) {
    if (jobsWithActual.has(finding.canonicalKey)) continue;
    byId.set(findingIdentity(finding), finding);
  }
  const findings = [...byId.values()];
  const critical = findings.filter((item) => item.severity === "critical").length;
  return {
    ...analysis,
    batchId: derived.batchId,
    locales: [...new Set([...analysis.locales, ...derived.locales])],
    analysis: {
      ...analysis.analysis,
      findings,
      critical,
      warnings: findings.length - critical,
      affectedScreens: findings.length ? new Set(findings.map((item) => item.screenLabel)).size : 0,
    },
    cases: analysis.cases.length ? analysis.cases : derived.cases,
  };
}

/** Merge analyzed Findings over typed cells by job identity. A richer analysis
 * of A replaces A's provisional row and must not drop B. Wrong-batch analysis
 * is ignored. Empty remains a QA gap. */
export function resolvePlanFindings(
  report: ProductBatchReport,
  analysis?: CombineEvidenceAnalysisReport,
  testNames: BatchTestNames = {},
): CombineEvidenceAnalysisReport {
  const derived = planFindingsFromBatch(report, testNames);
  const state = planFindingsAnalysisState(report, analysis);
  let resolved: CombineEvidenceAnalysisReport;
  if (!analysis || state === "failed") {
    resolved = derived.analysis.findings.length ? derived : emptyPlanFindingsReport(report.id);
  } else if (!analysis.analysis.findings.length && !derived.analysis.findings.length) {
    resolved = analysis;
  } else if (!analysis.analysis.findings.length) {
    resolved = derived;
  } else {
    resolved = mergePlanFindings(derived, analysis);
  }
  const findings = resolved.analysis.findings.map((finding) =>
    attachPlanFindingTestId(finding, report.cases),
  );
  return {
    ...resolved,
    analysis: { ...resolved.analysis, findings },
  };
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
    const testId = item.identity?.testId?.trim();
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
      ...(testId ? { testId } : {}),
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
