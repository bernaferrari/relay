import { ApiError } from "@relay/client";
import type { OperationId } from "@relay/protocol";

const codePattern = /^[a-z][a-z0-9_.-]{0,63}$/;
const localPath = /(?:file:\/\/)?(?:\/(?:Users|private|var|tmp|home)\/|[A-Za-z]:[\\/])[^\s"']+/gi;
const bearerCredential = /\bBearer\s+[^\s,;]+/gi;
const namedCredential = /\b(?:token|password|secret|credential|authorization)\s*[:=]\s*[^\s,;]+/gi;
const url = /https?:\/\/[^\s"']+/gi;
const iosMutationOutcomeUnknownCode = "IOS_MUTATION_OUTCOME_UNKNOWN";
const iosMutationOutcomeUnknownMessage =
  "Review needed: Relay cannot confirm whether the iOS command reached the device. Capture the current screen before any explicit retry or repair.";

export type RelayMcpRecoveryAction =
  | "fix-input"
  | "authenticate"
  | "request-access"
  | "acquire-lease"
  | "refresh-and-retry"
  | "retry-later"
  | "none";

export type RelayMcpRecoveryCommand = {
  operationId: string;
  input?: Record<string, unknown>;
  cli?: { argv: string[] };
};

/**
 * The MCP server must not present an operation from an error response as an
 * executable recovery command unless that operation is registered in the
 * selected profile. The error adapter stays independent of the profile
 * registry by accepting the already-resolved operation set from the server.
 */
export type RelayMcpErrorOptions = {
  /** Canonical operation ids registered as MCP tools for this request. */
  availableOperationIds?: ReadonlySet<string>;
  /** Selected profile, included in guidance when a recovery command is hidden. */
  profile?: string;
  /** Profiles that register a hidden recovery operation, when known. */
  availableProfilesForOperation?: (operationId: string) => readonly string[];
  /** Outcome tools are public even though they invoke canonical operations internally. */
  currentOperationAvailable?: boolean;
};

/**
 * The inspectable part of a terminal physical-iOS outcome. Keep it separate
 * from generic error text so an MCP agent can see why it must stop before
 * issuing another command.
 */
export type RelayMcpIosReview = {
  iosMutation?: Record<string, unknown>;
};

export type RelayMcpStructuredError = {
  /** Canonical operation id for raw tools, or the public outcome tool name. */
  operationId: OperationId | `relay_${string}`;
  status?: number;
  code: string;
  message: string;
  /** A physical iOS command may already have reached the device. Stop for review. */
  terminal?: "review-needed";
  recovery: {
    action: RelayMcpRecoveryAction;
    retryable: boolean;
  };
  recoveryAction?: RelayMcpRecoveryCommand;
  /** Explain how to continue when Relay's canonical recovery operation is not
   * registered by the selected least-privilege profile. */
  recoveryGuidance?: string;
  currentRevision?: number;
  iosReview?: RelayMcpIosReview;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function sanitizeErrorText(value: unknown, fallback: string): string {
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const sanitized = source
    .replace(bearerCredential, "Bearer [redacted]")
    .replace(namedCredential, "credential=[redacted]")
    .replace(localPath, "[local path redacted]")
    .replace(url, "[URL redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (sanitized || fallback).slice(0, 512);
}

function defaultCode(status: number): string {
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 412) return "precondition_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "relay_error";
}

function currentRevision(body: Record<string, unknown> | undefined): number | undefined {
  const direct = body?.currentRevision;
  if (Number.isSafeInteger(direct) && Number(direct) >= 0) return Number(direct);
  const current = object(body?.current);
  const nested = current?.revision;
  return Number.isSafeInteger(nested) && Number(nested) >= 0 ? Number(nested) : undefined;
}

function recoveryFor(status: number, message: string): RelayMcpStructuredError["recovery"] {
  if (status === 400 || status === 422) return { action: "fix-input", retryable: false };
  if (status === 401) return { action: "authenticate", retryable: false };
  if (status === 403) {
    return /\blease\b/i.test(message)
      ? { action: "acquire-lease", retryable: true }
      : { action: "request-access", retryable: false };
  }
  if (status === 409 || status === 412) {
    return { action: "refresh-and-retry", retryable: true };
  }
  if (status === 429 || status >= 500) return { action: "retry-later", retryable: true };
  return { action: "none", retryable: false };
}

function suppliedRecovery(
  value: unknown,
  fallback: RelayMcpStructuredError["recovery"],
): RelayMcpStructuredError["recovery"] {
  const input = object(value);
  const action = input?.action;
  if (
    action !== "fix-input" &&
    action !== "authenticate" &&
    action !== "request-access" &&
    action !== "acquire-lease" &&
    action !== "refresh-and-retry" &&
    action !== "retry-later" &&
    action !== "none"
  ) {
    return fallback;
  }
  return {
    action,
    retryable: typeof input?.retryable === "boolean" ? input.retryable : fallback.retryable,
  };
}

function recoveryActionFrom(value: unknown): RelayMcpStructuredError["recoveryAction"] | undefined {
  const input = object(value);
  if (!input || typeof input.operationId !== "string" || !input.operationId.trim())
    return undefined;
  const cli = object(input.cli);
  const argv = cli?.argv;
  const payload = object(input.input);
  return {
    operationId: input.operationId,
    ...(payload ? { input: payload } : {}),
    ...(Array.isArray(argv) && argv.every((item) => typeof item === "string")
      ? { cli: { argv } }
      : {}),
  };
}

function hiddenRecoveryGuidance(
  operationId: string,
  options: RelayMcpErrorOptions,
): string | undefined {
  if (!options.availableOperationIds || options.availableOperationIds.has(operationId)) {
    return undefined;
  }
  const profile = options.profile ? ` in selected MCP profile "${options.profile}"` : "";
  const availableProfiles = options.availableProfilesForOperation?.(operationId) ?? [];
  const profileHint = availableProfiles.length
    ? ` Start MCP with a profile that exposes it (${availableProfiles.join(", ")})`
    : " Use an authorized operator or profile that exposes it";
  return `Relay suggested recovery operation "${operationId}", but it is not available${profile}.${profileHint}, or ask an operator to invoke the canonical operation.`;
}

function profileSafeRecovery(
  recovery: RelayMcpStructuredError["recovery"],
  recoveryAction: RelayMcpStructuredError["recoveryAction"],
  options: RelayMcpErrorOptions | undefined,
): {
  recovery: RelayMcpStructuredError["recovery"];
  recoveryAction?: RelayMcpStructuredError["recoveryAction"];
  recoveryGuidance?: string;
} {
  if (!options?.availableOperationIds) {
    return { recovery, ...(recoveryAction ? { recoveryAction } : {}) };
  }

  const hiddenAction = recoveryAction
    ? hiddenRecoveryGuidance(recoveryAction.operationId, options)
    : undefined;
  const leaseUnavailable =
    recovery.action === "acquire-lease" && !options.availableOperationIds.has("lease.create");
  const retryUnavailable =
    recovery.action === "refresh-and-retry" && options.currentOperationAvailable === false;
  const guidance =
    hiddenAction ??
    (leaseUnavailable
      ? hiddenRecoveryGuidance("lease.create", options)
      : retryUnavailable
        ? hiddenRecoveryGuidance("refresh-and-retry", options)
        : undefined);

  // `acquire-lease` names a concrete canonical operation. If that operation
  // is outside the selected profile, do not leave an agent with a retryable
  // instruction that it cannot perform. The operator/profile handoff in the
  // guidance is the only safe continuation.
  const safeRecovery = leaseUnavailable
    ? { action: "request-access" as const, retryable: false }
    : retryUnavailable
      ? { action: "request-access" as const, retryable: false }
      : recovery;
  return {
    recovery: safeRecovery,
    ...(hiddenAction ? {} : recoveryAction ? { recoveryAction } : {}),
    ...(guidance ? { recoveryGuidance: guidance } : {}),
  };
}

function iosReviewFrom(body: Record<string, unknown> | undefined): RelayMcpIosReview | undefined {
  const iosMutation = object(body?.iosMutation);
  return iosMutation ? { iosMutation } : undefined;
}

export function relayMcpError(
  operationId: RelayMcpStructuredError["operationId"],
  error: unknown,
  options?: RelayMcpErrorOptions,
): RelayMcpStructuredError {
  const fallback = `Relay operation ${operationId} failed.`;
  if (!(error instanceof ApiError)) {
    return {
      operationId,
      code: "operation_failed",
      message: sanitizeErrorText(error instanceof Error ? error.message : error, fallback),
      recovery: { action: "none", retryable: false },
    };
  }

  const body = object(error.body);
  const suppliedCode = body?.code;
  const signInBlocked = suppliedCode === "ACCOUNT_NEEDS_RELOGIN";
  const code = signInBlocked
    ? suppliedCode
    : suppliedCode === iosMutationOutcomeUnknownCode ||
        (typeof suppliedCode === "string" && codePattern.test(suppliedCode))
      ? suppliedCode
      : defaultCode(error.status);
  // The terminal code is the authority. Diagnostic fields are best-effort:
  // they can be missing or malformed after a transport/proxy failure, but that
  // must never turn an already-issued physical command into a retryable 409.
  const terminalIosMutationOutcomeUnknown = code === iosMutationOutcomeUnknownCode;
  const message = terminalIosMutationOutcomeUnknown
    ? iosMutationOutcomeUnknownMessage
    : sanitizeErrorText(body?.error ?? error.message, fallback);
  const revision = currentRevision(body);
  const iosReview = terminalIosMutationOutcomeUnknown ? iosReviewFrom(body) : undefined;
  // An unknown physical iOS mutation has already used its one native command.
  // It is categorically different from a stale revision conflict: telling an
  // agent to refresh-and-retry would invite a duplicate press or scroll.
  // A blocked sign-in is not a retry of the same Plan.
  const recovery = signInBlocked
    ? { action: "authenticate" as const, retryable: false }
    : terminalIosMutationOutcomeUnknown
      ? { action: "none" as const, retryable: false }
      : suppliedRecovery(body?.recovery, recoveryFor(error.status, message));
  const recoveryAction =
    signInBlocked || terminalIosMutationOutcomeUnknown
      ? undefined
      : recoveryActionFrom(body?.recoveryAction);
  const profileSafe = profileSafeRecovery(recovery, recoveryAction, options);

  return {
    operationId,
    status: error.status,
    code,
    message,
    ...(terminalIosMutationOutcomeUnknown ? { terminal: "review-needed" as const } : {}),
    recovery: profileSafe.recovery,
    ...(profileSafe.recoveryAction ? { recoveryAction: profileSafe.recoveryAction } : {}),
    ...(signInBlocked
      ? {
          recoveryGuidance:
            "Completed captures are preserved. Refresh the sign-in, then resume this activity. Do not start the same Plan again until that sign-in is saved.",
        }
      : profileSafe.recoveryGuidance
        ? { recoveryGuidance: profileSafe.recoveryGuidance }
        : {}),
    ...(revision === undefined ? {} : { currentRevision: revision }),
    ...(iosReview ? { iosReview } : {}),
  };
}

export function invalidRelayMcpInput(
  operationId: OperationId,
  detail?: unknown,
): RelayMcpStructuredError {
  return {
    operationId,
    status: 400,
    code: "invalid_input",
    message: sanitizeErrorText(detail, `Invalid input for Relay operation ${operationId}.`),
    recovery: { action: "fix-input", retryable: false },
  };
}
