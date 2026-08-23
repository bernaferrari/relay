import type { FailureCategory, RunOutcome, RunReview } from "@relay/protocol";

export type ClassifiedOutcome = { outcome: RunOutcome; failureCategory?: FailureCategory };

export function classifyRunOutcome(input: {
  status: string;
  error?: string;
  errorCode?: string;
  review?: RunReview;
}): ClassifiedOutcome {
  if (input.review?.status === "pending" || input.review?.status === "rejected") {
    return { outcome: "uncertain", failureCategory: "review-required" };
  }
  if (input.status === "ok" || input.status === "healed") return { outcome: "passed" };
  if (input.status === "cancelled" || input.errorCode === "CANCELLED")
    return { outcome: "cancelled" };

  const message = (input.error ?? "").toLowerCase();
  // Infrastructure is causal when an assertion could not obtain trustworthy
  // target evidence. Check it before assertion wording because lower layers
  // often preserve both messages (for example, "expect-screen ... session
  // disconnected"). Such a run did not prove a product regression.
  if (input.errorCode === "DEVICE_MISSING" || /device|adb|session|connection/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "environment" };
  }
  if (input.errorCode === "INTERNAL") {
    return { outcome: "harness-failure", failureCategory: "harness-defect" };
  }
  if (/extract:/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "extraction" };
  }
  if (/wait-for:|response completion/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "completion" };
  }
  if (/tap failed|no strategy matched|no match/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "locator" };
  }
  if (/judge uncertain|insufficient evidence|judge disagreement/.test(message)) {
    return { outcome: "uncertain", failureCategory: "judge-uncertainty" };
  }
  if (/semantic assertion/.test(message)) {
    return { outcome: "product-failure", failureCategory: "semantic-assertion" };
  }
  if (/visual assertion/.test(message)) {
    return { outcome: "product-failure", failureCategory: "visual-assertion" };
  }
  if (/content assertion|expect(?:-screen)?:/.test(message)) {
    return { outcome: "product-failure", failureCategory: "deterministic-assertion" };
  }
  return { outcome: "harness-failure", failureCategory: "action" };
}
