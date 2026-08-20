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
export function iosInteractionFailure(error: unknown): IosInteractionFailure | undefined {
  const body = responseBody(error);
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
  const failure = iosInteractionFailure(error);
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
export function canFallbackToPointAfterFailedInteraction(input: {
  platform?: string;
  kind: string;
  hasPoint: boolean;
  failure?: IosInteractionFailure;
}): boolean {
  if (!input.hasPoint || input.kind === "point") return false;
  if (input.platform !== "ios") return true;
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
