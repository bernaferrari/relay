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
        detail: "Try again in a moment.",
        recovery: "If this continues, check that the Relay service is running.",
        retryable: true,
      };
    }
    switch (error.status) {
      case 401:
        return {
          title: "Reconnect to Relay",
          detail: "Relay could not verify your access.",
          recovery: "Check your Relay connection settings and access credentials, then try again.",
          retryable: false,
        };
      case 403:
        return {
          title: "You don’t have access to this action",
          detail: "Your current access does not allow this request.",
          recovery: "Ask the workspace owner to check your permissions.",
          retryable: false,
        };
      case 404:
        return {
          title: "This item is unavailable",
          detail: "Relay could not find the requested information.",
          recovery: "Return to the previous page and refresh it to see what is available.",
          retryable: false,
        };
      case 409:
        return {
          title: "This action conflicts with the current state",
          detail: "Relay cannot apply this request as it stands.",
          recovery: "Review the latest state before choosing your next action.",
          retryable: false,
        };
      case 429:
        return {
          title: "Relay needs a moment",
          detail: "Too many requests arrived at once.",
          recovery: "Wait a moment, then try the action again.",
          // No retry deadline is available here; do not offer an immediate repeat.
          retryable: false,
        };
      default:
        return error.status >= 500
          ? {
              title: "Relay could not complete that request",
              detail: "The service encountered a problem while handling this request.",
              recovery: "Try again in a moment. If this continues, check the Relay connection.",
              retryable: true,
            }
          : {
              title: "Relay could not accept this request",
              detail: "The information sent could not be used for this action.",
              recovery: "Check your selections and entered values before trying again.",
              retryable: false,
            };
    }
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
