import type { RunOutcome } from "@relay/protocol";

const reportedUnknownOutcomeCategories = new Set<string>();

export function runOutcome(value: unknown): RunOutcome | undefined {
  const known = ["passed", "product-failure", "harness-failure", "uncertain", "cancelled"];
  if (typeof value === "string" && known.includes(value)) return value as RunOutcome;
  if (value !== undefined && value !== null) {
    const category = Array.isArray(value) ? "array" : typeof value;
    if (!reportedUnknownOutcomeCategories.has(category)) {
      reportedUnknownOutcomeCategories.add(category);
      console.warn("Relay diagnostic", {
        component: "OutcomeMark",
        reason: "unknown-outcome",
        category,
      });
    }
  }
  return undefined;
}
