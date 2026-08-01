import type { FailureCategory, RunOutcome } from "@relay/protocol";

export type ClassifiedOutcome = { outcome: RunOutcome; failureCategory?: FailureCategory };

export function classifyRunOutcome(input: {
  status: string;
  error?: string;
  errorCode?: string;
}): ClassifiedOutcome {
  if (input.status === "ok" || input.status === "healed") return { outcome: "passed" };
  if (input.status === "cancelled" || input.errorCode === "CANCELLED")
    return { outcome: "cancelled" };

  const message = (input.error ?? "").toLowerCase();
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
  if (/extract:/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "extraction" };
  }
  if (/wait-for:|response completion/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "completion" };
  }
  if (/tap failed|no strategy matched|no match/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "locator" };
  }
  if (input.errorCode === "DEVICE_MISSING" || /device|adb|session|connection/.test(message)) {
    return { outcome: "harness-failure", failureCategory: "environment" };
  }
  if (input.errorCode === "INTERNAL") {
    return { outcome: "harness-failure", failureCategory: "harness-defect" };
  }
  return { outcome: "harness-failure", failureCategory: "action" };
}
