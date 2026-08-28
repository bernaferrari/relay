import type { WorkflowProblem } from "./types.js";

export function workflowErrorDetail(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Relay did not return a usable response.";
}

export function unavailableWorkflowProblem(stage: string, error: unknown): WorkflowProblem {
  return {
    code: "operation-unavailable",
    title: `Relay could not ${stage}`,
    detail: workflowErrorDetail(error),
    recovery: "Resolve the reported Relay problem, then start this workflow again explicitly.",
    retryable: true,
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
