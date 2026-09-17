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
  if (error instanceof ApiError) {
    const problem = workflowProblemFromBody(error.body);
    if (problem)
      return {
        title: problem.title,
        detail: problem.detail,
        recovery: problem.recovery,
        retryable: problem.retryable,
      };
    if ([502, 503, 504].includes(error.status)) {
      return {
        title: "Relay is temporarily unavailable",
        detail: "The service isn’t responding. Try again in a moment.",
        recovery: "If this continues, check that the Relay service is running.",
        retryable: true,
      };
    }
    return {
      title: "Relay could not complete that request",
      detail: `Relay returned HTTP ${error.status}.`,
      recovery:
        error.status >= 500 ? "Check Relay and try again." : "Review the request and try again.",
      retryable: error.status >= 500,
    };
  }
  if (isLocalServiceTransportFailure(error)) {
    return {
      title: "Relay is not connected",
      detail: "The app could not reach the local Relay service.",
      recovery:
        "Start Relay at its saved address, then try again. Your work on this screen is safe.",
      retryable: true,
    };
  }
  return {
    title: "Something went wrong",
    detail: "Relay returned an unexpected error.",
    recovery: "Check your connection and inspect Relay status before attempting this action again.",
    retryable: false,
  };
}

function isLocalServiceTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause =
    "cause" in error && error.cause instanceof Error
      ? ` ${error.cause.name} ${error.cause.message}`
      : "";
  const message = `${error.name} ${error.message}${cause}`;
  return /(?:failed to fetch|fetch failed|network\s*error|network request failed|load failed|err_connection_refused|connection (?:ended|failed|refused)|econnrefused|cors|cross-origin|offline)/iu.test(
    message,
  );
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

function workflowProblemFromBody(body: unknown): WorkflowProblem | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  return isWorkflowProblem(error) ? error : undefined;
}
