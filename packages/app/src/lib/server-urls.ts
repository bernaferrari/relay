import type { PersistedRun, TraceFrameRef } from "./api-types";

export function recordingEvidenceUrl(base: string, recipeId: string, evidenceId: string): string {
  return `${base}/journeys/${encodeURIComponent(recipeId)}/evidence/${encodeURIComponent(evidenceId)}`;
}

export function frameUrlForPersisted(
  base: string,
  run: PersistedRun,
  frame: TraceFrameRef,
): string {
  const file = frame.path.split(/[\\/]/).pop() ?? frame.path;
  return `${base}/runs/${encodeURIComponent(run.id)}/frames/${encodeURIComponent(file)}`;
}

export function videoUrlForRun(base: string, runId: string, path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return `${base}/runs/${encodeURIComponent(runId)}/video/${encodeURIComponent(file)}`;
}

export function visualBaselineFrameUrl(base: string, runId: string, frameIndex: number): string {
  return `${base}/runs/${encodeURIComponent(runId)}/visual-baseline-frame/${frameIndex}`;
}
