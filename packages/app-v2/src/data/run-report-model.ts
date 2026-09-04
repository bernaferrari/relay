import type { EvidenceChannel, RunOutcome, RunTestStepEvidence } from "@relay/protocol";

export type ReportEvidenceSection = {
  id: EvidenceChannel;
  label: string;
  count: number;
  detail: string;
  summary: string;
  inspectable: boolean;
  items: readonly ReportEvidenceItem[];
};

export type ReportEvidenceItem = {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  tone?: "neutral" | "success" | "warning" | "critical";
  media?: {
    kind: "image";
    src: string;
    width?: number;
    height?: number;
  };
};

export type ReportTimelineItem = {
  id: string;
  index: number;
  title: string;
  state: "passed" | "failed" | "running" | "recovered" | "pending";
  durationMs?: number;
  evidenceCount: number;
  /** Screenshot paths retained directly on the persisted trace step. */
  framePaths?: readonly string[];
  /** Present only when the backend provides an authored assertion join. */
  expected?: string;
  observed?: string;
};

export type ProductRunReportOverview = {
  runId: string;
  testId?: string;
  title: string;
  outcome?: RunOutcome;
  targetName?: string;
  durationMs?: number;
  cause?: string;
  category?: string;
  firstEvidence?: { label: string; detail?: string };
  timeline: readonly ReportTimelineItem[];
  evidence: readonly ReportEvidenceSection[];
  /** Undefined for legacy Runs that predate authored-step provenance. */
  stepEvidence?: readonly RunTestStepEvidence[];
  evidenceUnavailable?: true;
  executionContext?: {
    sourceRevision?: string;
    buildId?: string;
    browser?: string;
    targetProfileId?: string;
    appVersion?: string;
  };
};

/** Join authored-step evidence by its persisted trace index. Never infer a
 * relationship from array position: hidden or repeated trace steps make that
 * association unsafe. */
export function framePathsForTraceStep(
  stepEvidence: readonly RunTestStepEvidence[] | undefined,
  traceStepIndex: number,
): readonly string[] {
  return (
    stepEvidence?.find((item) => item.traceStepIndex === traceStepIndex)?.evidence.framePaths ?? []
  );
}
