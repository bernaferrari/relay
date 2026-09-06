import type { TracePackExportResponse } from "@relay/protocol";

export type RunEvidenceExportDocument = {
  fileName: string;
  digest: string;
  body: string;
};

/** Build a portable TracePack file only when the envelope names this Run. */
export function runEvidenceExportDocument(
  runId: string,
  result: TracePackExportResponse,
): RunEvidenceExportDocument {
  if (result.tracePack.source.runId !== runId || result.analysis.sourceRunId !== runId) {
    throw new TypeError("Relay returned TracePack evidence for a different Run.");
  }
  if (result.analysis.tracePackDigest !== result.tracePack.digest) {
    throw new TypeError("Relay returned TracePack analysis for a different evidence digest.");
  }
  return {
    fileName: `relay-run-${runId}.json`,
    digest: result.tracePack.digest,
    body: JSON.stringify(result),
  };
}
