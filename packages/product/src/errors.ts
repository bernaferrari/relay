import { ApiError } from "@relay/client";
import type { WorkflowProblem } from "@relay/workflows";
export type HumanError = { title: string; detail: string; recovery: string; retryable: boolean };
export function projectError(error: unknown): HumanError {
  if (isWorkflowProblem(error))
    return {
      title: error.title,
      detail: error.detail,
      recovery: error.recovery,
      retryable: error.retryable,
    };
  if (error instanceof ApiError)
    return {
      title: "Relay could not complete that request",
      detail: error.message,
      recovery:
        error.status >= 500 ? "Check Relay and try again." : "Review the request and try again.",
      retryable: error.status >= 500,
    };
  return {
    title: "Something went wrong",
    detail: error instanceof Error ? error.message : "Relay returned an unexpected error.",
    recovery: "Check your connection and try again.",
    retryable: true,
  };
}
function isWorkflowProblem(value: unknown): value is WorkflowProblem {
  return Boolean(
    value &&
    typeof value === "object" &&
    "title" in value &&
    "detail" in value &&
    "recovery" in value &&
    "retryable" in value,
  );
}
