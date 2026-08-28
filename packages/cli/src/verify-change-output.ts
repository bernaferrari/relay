import type { VerifyChangeResult } from "@relay/protocol";

function isVerifyChangeResult(value: unknown): value is VerifyChangeResult {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Partial<VerifyChangeResult>).kind === "verify-change" &&
    (value as Partial<VerifyChangeResult>).mode === "offline"
  );
}

function list(label: string, values: readonly string[]): string[] {
  return values.length ? [`${label}:`, ...values.map((value) => `  - ${value}`)] : [];
}

/** Human projection of the same bounded protocol result returned to JSON and
 * MCP clients. It intentionally renders references, never raw TracePack data. */
export function formatVerifyChangeResult(value: unknown): string | undefined {
  if (!isVerifyChangeResult(value)) return undefined;
  const { summary, evidenceCompleteness, smallestRequiredLiveVerification: live } = value;
  const affected = value.affectedTests.map(
    (test) =>
      `  - ${test.appMapId ? `${test.appMapId}/` : ""}${test.testId}: ${test.verdict} (${test.evidenceRunIds.length} run${test.evidenceRunIds.length === 1 ? "" : "s"})`,
  );
  const causal = value.firstCausalFailure
    ? [
        "First causal failure:",
        `  ${value.firstCausalFailure.runId}/${value.firstCausalFailure.checkId}: ${value.firstCausalFailure.title} (${value.firstCausalFailure.kind})`,
      ]
    : [];
  return [
    `Verify change: ${summary.verdict}`,
    `Affected Tests: ${summary.affectedTests} (${summary.passed} passed, ${summary.regressions} regressions, ${summary.review} review, ${summary.insufficient} insufficient)`,
    `Evidence: ${evidenceCompleteness.status} (${evidenceCompleteness.complete} complete, ${evidenceCompleteness.partial} partial)`,
    `Policy: ${value.policy.id}@${value.policy.version} · ${value.decision} · ${value.execution}`,
    `Confidence: ${value.confidence.value} (${value.confidence.basis})`,
    ...(affected.length ? ["Affected Test results:", ...affected] : []),
    ...causal,
    ...list("Policy rules", value.ruleIds),
    ...list("Evidence references", value.evidenceRefs),
    ...list("Missing evidence", evidenceCompleteness.missing),
    ...list("Unresolved uncertainty", value.unresolvedUncertainty),
    `Smallest required live verification: ${live.required ? live.action : "none"}`,
    `  ${live.reason}`,
    ...(live.testId ? [`  Test: ${live.appMapId ? `${live.appMapId}/` : ""}${live.testId}`] : []),
  ].join("\n");
}
