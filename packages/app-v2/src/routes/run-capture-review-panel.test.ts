import { describe, expect, it } from "vitest";
import { captureReviewSummaryLine } from "./run-capture-review-panel";

describe("captureReviewSummaryLine", () => {
  it("reports captured and pending without calling the Run passed", () => {
    expect(
      captureReviewSummaryLine({
        items: [],
        summary: {
          captured: 8,
          missing: 0,
          pending: 5,
          accepted: 2,
          issue: 1,
          needMoreEvidence: 0,
        },
      }),
    ).toBe("8/8 captured · 5 pending review · 2 accepted · 1 issue");
  });

  it("shows 47/50 captured when three screenshots are missing", () => {
    expect(
      captureReviewSummaryLine({
        items: [],
        summary: {
          captured: 47,
          missing: 3,
          pending: 40,
          accepted: 5,
          issue: 2,
          needMoreEvidence: 0,
        },
      }),
    ).toBe("47/50 captured · 40 pending review · 5 accepted · 2 issues · 3 missing");
  });
});
