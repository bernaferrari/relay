import type { WorkflowProblem } from "./types.js";

export function workflowErrorDetail(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Relay did not return a usable response.";
}

export function unavailableWorkflowProblem(stage: string, error: unknown): WorkflowProblem {
  const capturedSetup = capturedSetupConflict(error);
  if (capturedSetup) return capturedSetup;
  return {
    code: "operation-unavailable",
    title: `Relay could not ${stage}`,
    detail: workflowErrorDetail(error),
    recovery: "Resolve the reported Relay problem, then start this workflow again explicitly.",
    retryable: true,
  };
}

function capturedSetupConflict(error: unknown): WorkflowProblem | undefined {
  if (!error || typeof error !== "object" || !("body" in error)) return undefined;
  const body = error.body;
  if (!body || typeof body !== "object") return undefined;
  const details =
    "code" in body && body.code === "target-profile-ambiguous"
      ? body
      : "details" in body && body.details && typeof body.details === "object"
        ? body.details
        : body;
  if (!("code" in details) || details.code !== "target-profile-ambiguous") return undefined;
  const stepId =
    "stepId" in details && typeof details.stepId === "string"
      ? details.stepId.trim().slice(0, 8_192)
      : undefined;
  return {
    code: "compile-blocked",
    title: "Saved setup needs review",
    detail:
      "Recorded screens disagree about the setup for this Test. Relay cannot choose one safely.",
    recovery: "Review the affected step’s capture in the Test editor before running again.",
    retryable: false,
    sourceCode: "target-profile-ambiguous",
    ...(stepId ? { sourceStepId: stepId } : {}),
  };
}

export function mutationUnknownWorkflowProblem(action: string, error: unknown): WorkflowProblem {
  return {
    code: "mutation-outcome-unknown",
    title: `Relay cannot prove whether ${action}`,
    detail: workflowErrorDetail(error),
    recovery:
      "Inspect canonical jobs before starting or cancelling anything again. Relay will not retry this mutation.",
    retryable: false,
  };
}
