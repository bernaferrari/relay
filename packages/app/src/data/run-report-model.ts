import type {
  CaptureReviewQueue,
  EvidenceChannel,
  RunOutcome,
  RunTestStepEvidence,
} from "@relay/protocol";

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
  phase?: "before" | "after";
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  tone?: "neutral" | "success" | "warning" | "critical";
  media?: {
    kind: "image";
    src: string;
    load?: () => Promise<Blob>;
    width?: number;
    height?: number;
  };
};

export type ReportVideoMedia = {
  kind: "video";
  src?: string;
  mime: "video/mp4" | "video/webm";
  load?: (signal?: AbortSignal) => Promise<Blob>;
  clock: {
    startedAt?: number;
    finishedAt?: number;
  };
};

export type ReportDiagnosticEvent = {
  id: string;
  title: string;
  at?: number;
  videoTimeMs?: number;
};

export type ReportTimelineItem = {
  phase?: "setup" | "test";
  id: string;
  index: number;
  title: string;
  state: "passed" | "failed" | "running" | "recovered" | "pending" | "blocked";
  durationMs?: number;
  attempt?: number;
  startedAt?: number;
  finishedAt?: number;
  log?: string;
  evidenceCount: number;
  actionBounds?: { x: number; y: number; width: number; height: number };
  beforeFramePath?: string;
  /** Screenshot paths retained directly on the persisted trace step. */
  framePaths?: readonly string[];
  /** Present only when the backend provides an authored assertion join. */
  expected?: string;
  observed?: string;
};

export type ReportPerformanceSeries = {
  name: string;
  points: readonly { at: number; value: number }[];
};

export type ProductRunReportOverview = {
  performance?: readonly ReportPerformanceSeries[];
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
  video?: ReportVideoMedia;
  diagnostics?: readonly ReportDiagnosticEvent[];
  /** Undefined for legacy Runs that predate authored-step provenance. */
  stepEvidence?: readonly RunTestStepEvidence[];
  evidenceUnavailable?: true;
  executionContext?: {
    sourceRevision?: string;
    buildId?: string;
    browser?: string;
    targetProfileId?: string;
    appVersion?: string;
    account?: string;
    viewport?: string;
    locale?: string;
  };
  captureReview?: CaptureReviewQueue;
  /** Every engine step in order, unfiltered; the story view groups these. */
  traceSteps?: readonly ReportTimelineItem[];
};

/** Join authored-step evidence by its persisted trace identity. The numeric
 * fallback is retained for legacy callers and old reports only. */
export function framePathsForTraceStep(
  stepEvidence: readonly RunTestStepEvidence[] | undefined,
  traceStepIdOrIndex: string | number,
  legacyTraceStepIndex?: number,
): readonly string[] {
  const match =
    typeof traceStepIdOrIndex === "string"
      ? stepEvidence?.find((item) => item.traceStepId === traceStepIdOrIndex)
      : stepEvidence?.find((item) => item.traceStepIndex === traceStepIdOrIndex);
  return (
    match?.evidence.framePaths ??
    (legacyTraceStepIndex === undefined
      ? []
      : (stepEvidence?.find((item) => item.traceStepIndex === legacyTraceStepIndex)?.evidence
          .framePaths ?? []))
  );
}
