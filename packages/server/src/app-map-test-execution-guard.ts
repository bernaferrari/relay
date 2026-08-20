import {
  AppMapTestExecutionReviewRequiredError,
  revalidateAppMapTestExecutionSource,
  type AppMapTestExecutionIntent,
  type AppMapTestExecutionSource,
} from "@relay/core";
import { HttpError } from "./http.js";

function reviewRequiredHttpError(reason: string): HttpError {
  return new HttpError(
    409,
    "This App Map Test execution needs review before Relay can control a target.",
    {
      code: "APP_MAP_TEST_EXECUTION_INTENT_REVIEW_REQUIRED",
      reason,
      recovery:
        "Open the current App Map Test, run offline preflight again, then start a new scoped Test run instead of retrying this historical execution.",
    },
  );
}

/** Map a second asynchronous core validation to the same terminal transport
 * contract as the first route-side validation. */
export function appMapTestExecutionReviewHttpError(error: unknown): HttpError | undefined {
  return error instanceof AppMapTestExecutionReviewRequiredError
    ? reviewRequiredHttpError(error.reason)
    : undefined;
}

/** The single server-side membrane for any existing Test execution. It runs
 * before a lease, snapshot, enqueue, or repair compilation can turn stale
 * history into a new device action. */
export async function requireScopedAppMapTestExecution(
  source: AppMapTestExecutionSource,
): Promise<AppMapTestExecutionIntent | undefined> {
  const assessment = await revalidateAppMapTestExecutionSource(source);
  if (assessment.status === "not-app-map-test") return undefined;
  if (assessment.status === "valid") return assessment.intent;
  throw reviewRequiredHttpError(assessment.reason);
}
