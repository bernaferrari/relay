import type { VerifyChangeResult } from "@relay/protocol";

type VerifyChangePlanResult = {
  kind: "verify-change-plan";
  git: {
    baseRef: string;
    baseSha: string;
    headSha: string;
    changedFiles: readonly string[];
  };
  plan: {
    status: string;
    selection: {
      affectedJourneys: ReadonlyArray<{
        appMapId: string;
        testId: string;
        confidence: string;
        reason: string;
      }>;
      targetCases: ReadonlyArray<{ id: string; required: boolean }>;
    };
    pilotTargetCaseId?: string;
    expansion: { targetCaseIds: readonly string[]; maxCases: number; maxDurationMs: number };
    coverageGaps: ReadonlyArray<{ code: string; reason: string }>;
  };
  proof?: { id?: string; state?: string };
  execution: {
    confirmed: boolean;
    proofStarted: boolean;
    planApproved: boolean;
    pilot: {
      available: boolean;
      attempted: boolean;
      reason: string;
      targetCaseId?: string;
      runId?: string;
    };
    runs: ReadonlyArray<{
      appMapId: string;
      testId: string;
      targetCaseId: string;
      jobId: string;
      runId: string;
    }>;
    terminalState?: string;
    nextAction: { kind: string; reason: string; command?: string };
  };
};

function isVerifyChangeResult(value: unknown): value is VerifyChangeResult {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Partial<VerifyChangeResult>).kind === "verify-change" &&
    (value as Partial<VerifyChangeResult>).mode === "offline"
  );
}

function isVerifyChangePlanResult(value: unknown): value is VerifyChangePlanResult {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Partial<VerifyChangePlanResult>).kind === "verify-change-plan"
  );
}

function list(label: string, values: readonly string[]): string[] {
  return values.length ? [`${label}:`, ...values.map((value) => `  - ${value}`)] : [];
}

/** Human projection of the same bounded protocol result returned to JSON and
 * MCP clients. It intentionally renders references, never raw TracePack data. */
export function formatVerifyChangeResult(value: unknown): string | undefined {
  if (isVerifyChangePlanResult(value)) {
    const { git, plan, execution } = value;
    const journeys = plan.selection.affectedJourneys.map(
      (journey) =>
        `  - ${journey.appMapId}/${journey.testId} (${journey.confidence}): ${journey.reason}`,
    );
    const targets = plan.selection.targetCases.map(
      (target) => `  - ${target.id}${target.required ? " (required)" : ""}`,
    );
    const gaps = plan.coverageGaps.map((gap) => `  - ${gap.code}: ${gap.reason}`);
    return [
      `Verify change plan: ${plan.status}`,
      `Git: ${git.baseRef} (${git.baseSha}) → HEAD (${git.headSha})`,
      `Changed files: ${git.changedFiles.length}`,
      ...(git.changedFiles.length ? git.changedFiles.map((path) => `  - ${path}`) : []),
      `Affected Tests: ${plan.selection.affectedJourneys.length}`,
      ...(journeys.length ? journeys : ["  - none (coverage is unresolved)"]),
      `Pilot: ${plan.pilotTargetCaseId ?? "none"}`,
      `Target cases: ${plan.selection.targetCases.length}`,
      ...(targets.length ? targets : ["  - none (a required target case is missing)"]),
      `Expansion: ${plan.expansion.targetCaseIds.length} additional target case(s), max ${plan.expansion.maxCases} case(s) / ${plan.expansion.maxDurationMs}ms`,
      `Coverage gaps: ${plan.coverageGaps.length}`,
      ...gaps,
      `Proof: ${execution.proofStarted ? (value.proof?.id ?? "created") : "not created (confirmation required)"}`,
      `Plan approval: ${execution.planApproved ? "recorded" : "not recorded"}`,
      `Pilot execution: ${execution.pilot.attempted ? "completed" : "not attempted"}${execution.pilot.targetCaseId ? ` (${execution.pilot.targetCaseId})` : ""} — ${execution.pilot.reason}`,
      ...(execution.runs.length
        ? [
            "Recorded Runs:",
            ...execution.runs.map(
              (run) => `  - ${run.appMapId}/${run.testId}/${run.targetCaseId}: ${run.runId}`,
            ),
          ]
        : []),
      ...(execution.terminalState ? [`Proof terminal state: ${execution.terminalState}`] : []),
      `Next action: ${execution.nextAction.reason}`,
      ...(execution.nextAction.command ? [`  ${execution.nextAction.command}`] : []),
    ].join("\n");
  }
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
