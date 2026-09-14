import { describe, expect, it } from "vitest";
import type { CombineEvidenceAnalysisReport, CombineEvidenceFinding } from "@relay/protocol";
import { findingScreenshotRunId } from "./batch-finding-review";

const finding = (
  partial: Partial<CombineEvidenceFinding> & Pick<CombineEvidenceFinding, "id" | "canonicalKey">,
): CombineEvidenceFinding => ({
  code: "HARNESS_FAILURE",
  severity: "critical",
  confidence: "high",
  screenLabel: "Toolbar",
  locale: "logged-out",
  baselineLocale: "logged-out",
  detail: "SOS",
  ...partial,
});

const report = (
  cases: CombineEvidenceAnalysisReport["cases"],
): CombineEvidenceAnalysisReport => ({
  schemaVersion: 1,
  batchId: "batch-1",
  locales: ["logged-out"],
  analysis: {
    schemaVersion: 1,
    sessionId: "s1",
    generatedAt: 1,
    baselineLocale: "logged-out",
    findings: [],
    critical: 0,
    warnings: 0,
    affectedScreens: 0,
  },
  coverage: { frames: 0, inspectedFrames: 0 },
  cases,
});

describe("findingScreenshotRunId", () => {
  it("uses the job: canonical key", () => {
    expect(
      findingScreenshotRunId(
        finding({
          id: "harness-failure-099e8094-8018-4d44-b00b-73d2290b2f3f",
          canonicalKey: "job:099e8094-8018-4d44-b00b-73d2290b2f3f",
        }),
        report([]),
      ),
    ).toBe("099e8094-8018-4d44-b00b-73d2290b2f3f");
  });

  it("falls back to a case job id inside the finding id", () => {
    expect(
      findingScreenshotRunId(
        finding({ id: "harness-failure-job-home", canonicalKey: "toolbar" }),
        report([{ jobId: "job-home", locale: "en", status: "cancelled", frames: [] }]),
      ),
    ).toBe("job-home");
  });
});
