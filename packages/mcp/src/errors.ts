import { ApiError } from "@relay/client";
import type { OperationId } from "@relay/protocol";

const codePattern = /^[a-z][a-z0-9_.-]{0,63}$/;
const localPath = /(?:file:\/\/)?(?:\/(?:Users|private|var|tmp|home)\/|[A-Za-z]:[\\/])[^\s"']+/gi;
const bearerCredential = /\bBearer\s+[^\s,;]+/gi;
const namedCredential = /\b(?:token|password|secret|credential|authorization)\s*[:=]\s*[^\s,;]+/gi;
const url = /https?:\/\/[^\s"']+/gi;

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

export type RelayMcpStructuredError = {
  operationId: OperationId;
  status?: number;
  code: string;
  message: string;
  recovery: {
    action: RelayMcpRecoveryAction;
    retryable: boolean;
  };
  recoveryAction?: RelayMcpRecoveryCommand;
  currentRevision?: number;
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

export function relayMcpError(operationId: OperationId, error: unknown): RelayMcpStructuredError {
  const fallback = `Relay operation ${operationId} failed.`;
  if (!(error instanceof ApiError)) {
    return {
      operationId,
      code: "operation_failed",
      message: fallback,
      recovery: { action: "none", retryable: false },
    };
  }

  const body = object(error.body);
  const suppliedCode = body?.code;
  const code =
    typeof suppliedCode === "string" && codePattern.test(suppliedCode)
      ? suppliedCode
      : defaultCode(error.status);
  const message = sanitizeErrorText(body?.error ?? error.message, fallback);
  const revision = currentRevision(body);
  const recovery = suppliedRecovery(body?.recovery, recoveryFor(error.status, message));
  const recoveryAction = recoveryActionFrom(body?.recoveryAction);

  return {
    operationId,
    status: error.status,
    code,
    message,
    recovery,
    ...(recoveryAction ? { recoveryAction } : {}),
    ...(revision === undefined ? {} : { currentRevision: revision }),
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
