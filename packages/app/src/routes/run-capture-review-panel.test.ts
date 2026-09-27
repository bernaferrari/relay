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
    ).toBe("8/8 captured · 5 screenshots awaiting review · 2 accepted · 1 issue");
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
    ).toBe("47/50 captured · 40 screenshots awaiting review · 5 accepted · 2 issues · 3 missing");
  });

  it("reports planned and blocked on a Plan queue without accepting a baseline", () => {
    expect(
      captureReviewSummaryLine({
        summary: {
          captured: 1,
          missing: 0,
          pending: 1,
          accepted: 0,
          issue: 0,
          needMoreEvidence: 0,
          planned: 2,
          blocked: 1,
        },
      }),
    ).toBe(
      "2 planned · 1 captured · 1 blocked · 0 missing · 1 screenshot awaiting review · 0 accepted",
    );
  });
});
