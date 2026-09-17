import { describe, expect, it } from "vitest";
import { captureReviewFeedback } from "./capture-review-feedback";

describe("exact review acknowledgement", () => {
  it("does not clear missing, duplicate, or foreign acknowledgements", () => {
    const requested = [
      { runId: "run-a", captureId: "image-a" },
      { runId: "run-b", captureId: "image-b" },
    ];
    const feedback = captureReviewFeedback(requested, [
      { ...requested[0]!, status: "applied" },
      { ...requested[0]!, status: "conflict" },
      { runId: "foreign", captureId: "image-b", status: "applied" },
    ]);
    expect(feedback.savedKeys).toEqual([]);
    expect(feedback.failures).toHaveLength(2);
    expect(feedback.failures.every((item) => item.message.includes("not confirmed"))).toBe(true);
  });
});
