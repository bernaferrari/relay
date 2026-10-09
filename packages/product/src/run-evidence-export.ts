import type { TracePackExportResponse, WalkthroughPackExportResponse } from "@relay/protocol";
import { walkthroughHtml } from "./walkthrough-html.js";
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
    throw new TypeError("Relay returned TracePack evidence for a different run.");
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

/** Build a walkthrough file only when the pack still names this Run. */
export function walkthroughExportDocument(
  runId: string,
  result: WalkthroughPackExportResponse,
): RunEvidenceExportDocument {
  if (!result.pack.manifest.pinned.runIds.includes(runId)) {
    throw new TypeError("Relay returned a walkthrough for a different run.");
  }
  return {
    fileName: `relay-walkthrough-${runId}.html`,
    digest: result.pack.digest,
    body: walkthroughHtml(result),
  };
}
