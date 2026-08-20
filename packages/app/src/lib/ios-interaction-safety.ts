/**
 * Client-side guardrails for physical iOS actions.
 *
 * The server/core own native dispatch. The renderer must only decide whether
 * a second, *different* request is safe. In particular, it must never turn a
 * 409 "outcome unknown" into a coordinate tap just because a named attempt
 * returned false.
 */
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function responseBody(error: unknown): UnknownRecord | undefined {
  return asRecord(asRecord(error)?.body);
}

export type IosInteractionFailure = {
  code: string;
  mutation?: {
    operation?: string;
    nativeAttempts?: number;
    outcome?: string;
    retry?: { decision?: string; reason?: string };
    intervention?: { action?: string };
  };
};

/** Preserve only the reviewed fields a renderer needs to make a follow-up
 * decision. Raw transport errors stay out of UI state and never become a
 * reason to guess that another point tap is safe. */
export function iosInteractionFailureFromPayload(
  payload: unknown,
): IosInteractionFailure | undefined {
  const body = asRecord(payload);
  if (typeof body?.code !== "string") return undefined;
  const rawMutation = asRecord(body.iosMutation);
  const rawRetry = asRecord(rawMutation?.retry);
  const rawIntervention = asRecord(rawMutation?.intervention);
  return {
    code: body.code,
    ...(rawMutation
      ? {
          mutation: {
            ...(typeof rawMutation.operation === "string"
              ? { operation: rawMutation.operation }
              : {}),
            ...(typeof rawMutation.nativeAttempts === "number"
              ? { nativeAttempts: rawMutation.nativeAttempts }
              : {}),
            ...(typeof rawMutation.outcome === "string" ? { outcome: rawMutation.outcome } : {}),
            ...(rawRetry
              ? {
                  retry: {
                    ...(typeof rawRetry.decision === "string"
                      ? { decision: rawRetry.decision }
                      : {}),
                    ...(typeof rawRetry.reason === "string" ? { reason: rawRetry.reason } : {}),
                  },
                }
              : {}),
            ...(rawIntervention && typeof rawIntervention.action === "string"
              ? { intervention: { action: rawIntervention.action } }
              : {}),
          },
        }
      : {}),
  };
}

export function iosInteractionFailure(error: unknown): IosInteractionFailure | undefined {
  return iosInteractionFailureFromPayload(responseBody(error));
}

/** A machine-readable stop supplied by the server after exactly one native
 * iOS command. The current pixels are evidence, not a prompt to retry. */
export type IosMutationOutcomeUnknownIntervention = {
  title: "Action may already have happened";
  detail: string;
  screenshotCaption: string;
  operation: string;
};

export function iosMutationOutcomeUnknownIntervention(
  error: unknown,
  label: string,
): IosMutationOutcomeUnknownIntervention | undefined {
  return iosMutationOutcomeUnknownInterventionFromPayload(responseBody(error), label);
}

/** The standalone-step endpoint reports an in-band terminal result rather
 * than throwing an HTTP error. Reuse the exact same diagnostic predicate so
 * a result cannot be mistaken for ordinary failure and retried. */
export function iosMutationOutcomeUnknownInterventionFromPayload(
  payload: unknown,
  label: string,
): IosMutationOutcomeUnknownIntervention | undefined {
  const failure = iosInteractionFailureFromPayload(payload);
  const diagnostic = failure?.mutation;
  const retry = diagnostic?.retry;
  const intervention = diagnostic?.intervention;
  if (
    failure?.code !== "IOS_MUTATION_OUTCOME_UNKNOWN" ||
    diagnostic?.outcome !== "outcome-unknown" ||
    diagnostic?.nativeAttempts !== 1 ||
    retry?.decision !== "blocked" ||
    intervention?.action !== "capture-current-screen-before-any-retry"
  ) {
    return undefined;
  }
  const operation = typeof diagnostic.operation === "string" ? diagnostic.operation : "action";
  return {
    title: "Action may already have happened",
    detail:
      "Relay sent one iOS command and did not retry it. The current screen is saved for review before any next action.",
    screenshotCaption: `review before retry · ${label}`,
    operation,
  };
}

/**
 * Android retains its historical semantic-to-point rescue. iOS owns the one
 * permitted selector-miss fallback in core, before returning to the UI. A
 * renderer fallback is therefore forbidden unless a future server contract
 * explicitly proves that no selector command reached the device.
 */
/**
 * The one policy that can authorize a renderer-level point fallback.
 *
 * Keep this private. A false-y result, a stale selector, or a transport
 * failure are not authority to send another iOS command. Callers must go
 * through {@link dispatchWithSafePointFallback}, which preserves an unknown
 * outcome instead of accidentally turning it into a second request.
 */
function canFallbackToPointAfterFailedInteraction(input: {
  platform?: string;
  kind: string;
  hasPoint: boolean;
  failure?: IosInteractionFailure;
}): boolean {
  if (!input.hasPoint || input.kind === "point") return false;
  // A missing platform proof is not permission to issue a physical point
  // command. Android/browser keep their existing rescue behavior; iOS needs
  // the exact server no-dispatch proof below, and every unknown target stops.
  if (input.platform === "android" || input.platform === "browser") return true;
  if (input.platform !== "ios") return false;
  const diagnostic = input.failure?.mutation;
  const retry = diagnostic?.retry;
  return (
    input.failure?.code === "IOS_SELECTOR_NOT_DISPATCHED" &&
    diagnostic?.outcome === "selector-miss" &&
    diagnostic?.nativeAttempts === 1 &&
    retry?.decision === "safe-selector-fallback" &&
    retry?.reason === "selector-was-not-dispatched"
  );
}

type PointFallbackBase<Result> = {
  /** iOS is deliberately strict; other platforms retain their existing
   * semantic-to-point rescue behavior. */
  platform?: string;
  kind: string;
  hasPoint: boolean;
  attempt: () => Promise<Result>;
  pointFallback: () => Promise<Result>;
};

type ErrorOnlyPointFallback<Result> = PointFallbackBase<Result> & {
  failedResult?: never;
  failureForResult?: never;
};

type ResultAwarePointFallback<Result> = PointFallbackBase<Result> & {
  /** A renderer transport such as `interactStep` may turn HTTP errors into a
   * typed result. It must provide both the failed result predicate and the
   * reviewed server diagnostic before a fallback is even considered. */
  failedResult: (result: Result) => boolean;
  failureForResult: (result: Result) => IosInteractionFailure | undefined;
};

/**
 * The canonical renderer boundary for a semantic-to-point rescue.
 *
 * For physical iOS this invokes `pointFallback` only when the server proves
 * that the first selector command was *not dispatched*. An unknown outcome,
 * stale/no-op result, or arbitrary error returns/rethrows without another
 * device command. This is intentionally generic so the normal stage,
 * recorder, and authoring-session transports cannot grow subtly different
 * retry policies.
 */
export async function dispatchWithSafePointFallback<Result>(
  input: ErrorOnlyPointFallback<Result> | ResultAwarePointFallback<Result>,
): Promise<Result> {
  try {
    const result = await input.attempt();
    const failedResult = input.failedResult;
    const failureForResult = input.failureForResult;
    if (
      failedResult &&
      failureForResult &&
      failedResult(result) &&
      canFallbackToPointAfterFailedInteraction({
        platform: input.platform,
        kind: input.kind,
        hasPoint: input.hasPoint,
        failure: failureForResult(result),
      })
    ) {
      return input.pointFallback();
    }
    return result;
  } catch (error) {
    if (
      canFallbackToPointAfterFailedInteraction({
        platform: input.platform,
        kind: input.kind,
        hasPoint: input.hasPoint,
        failure: iosInteractionFailure(error),
      })
    ) {
      return input.pointFallback();
    }
    throw error;
  }
}

/** A boolean is too weak to represent an uncertain iOS command. Keep the
 * narrowing at the call site explicit instead of relying on truthiness. */
export function interactionSucceeded(input: { status: string }): boolean {
  return input.status === "succeeded";
}
