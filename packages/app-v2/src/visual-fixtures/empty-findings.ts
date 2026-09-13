import type { CombineEvidenceAnalysisReport } from "@relay/protocol";

export function emptyPlanFindings(batchId: string): CombineEvidenceAnalysisReport {
  return {
    schemaVersion: 1,
    batchId,
    locales: ["en"],
    analysis: {
      schemaVersion: 1,
      sessionId: "fixture",
      generatedAt: 1,
      baselineLocale: "en",
      findings: [],
      critical: 0,
      warnings: 0,
      affectedScreens: 0,
    },
    coverage: { frames: 0, inspectedFrames: 0 },
    cases: [],
  };
}
