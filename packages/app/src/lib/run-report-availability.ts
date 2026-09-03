import type { RunEvidenceQuery } from "@relay/protocol";
import type { JobInfo } from "./api-types";
import { hasVisualRunFrames } from "./visual-run-readiness";

export type RunReportTabId =
  | "timeline"
  | "summary"
  | "visual"
  | "evaluation"
  | "network"
  | "logs"
  | "performance";

export function structuredNetworkEvidenceCount(evidence: RunEvidenceQuery | null): number {
  if (!evidence) return 0;
  return evidence.network.length + (evidence.androidNetwork?.flows.length ?? 0);
}

export function runReportTabAvailable(input: {
  id: RunReportTabId;
  job: JobInfo | null;
  evidence: RunEvidenceQuery | null;
  checkCount: number;
}): boolean {
  const { id, job, evidence } = input;
  if (!job || id === "timeline" || id === "summary") return true;
  if (id === "visual") return hasVisualRunFrames(job.frames ?? []);
  if (id === "evaluation") return input.checkCount > 0;
  if (id === "network") return structuredNetworkEvidenceCount(evidence) > 0;
  if (id === "logs") return (job.logs?.length ?? 0) + (evidence?.logs.length ?? 0) > 0;
  return Boolean(evidence?.performance || job.durationMs);
}
