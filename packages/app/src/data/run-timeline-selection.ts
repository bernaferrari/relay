import type { ReportTimelineItem } from "./run-report-model";

export function initialRunStep(timeline: readonly ReportTimelineItem[]): number {
  const failure = timeline.findIndex((step) => step.state === "failed" || step.state === "blocked");
  if (failure >= 0) return failure;
  const authoredEvidence = timeline.findIndex(
    (step) => step.phase !== "setup" && Boolean(step.framePaths?.length),
  );
  if (authoredEvidence >= 0) return authoredEvidence;
  const evidence = timeline.findIndex((step) => Boolean(step.framePaths?.length));
  return Math.max(0, evidence);
}
