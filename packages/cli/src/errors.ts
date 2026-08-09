import { ApiError } from "@relay/client";

export const ExitCode = {
  success: 0,
  usage: 2,
  connection: 3,
  auth: 4,
  validation: 5,
  conflict: 6,
  cancellation: 7,
  server: 8,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, ExitCode.usage);
    this.name = "UsageError";
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "CanceledError");
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("code" in body)) return;
  return typeof body.code === "string" ? body.code : undefined;
}

export function classifyError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (isAbort(error)) return new CliError("Operation cancelled", ExitCode.cancellation);
  if (isTimeout(error)) return new CliError("Server request timed out", ExitCode.connection);
  if (error instanceof ApiError) {
    if (errorCode(error.body)?.startsWith("TARGET_CONTROL_LEASE_")) {
      return new CliError(error.message, ExitCode.conflict, error.body);
    }
    if (error.status === 401 || error.status === 403) {
      return new CliError(error.message, ExitCode.auth, error.body);
    }
    if (error.status === 409) return new CliError(error.message, ExitCode.conflict, error.body);
    if ([400, 404, 405, 412, 422].includes(error.status)) {
      return new CliError(error.message, ExitCode.validation, error.body);
    }
    if (error.status === 408) return new CliError(error.message, ExitCode.connection, error.body);
    if (error.status === 499) return new CliError(error.message, ExitCode.cancellation, error.body);
    if (/no active session|run open first/i.test(error.message)) {
      return new CliError(
        "The app is open, but the tap session is not attached. Retry the tap once.",
        ExitCode.server,
        error.body,
      );
    }
    return new CliError(error.message, ExitCode.server, error.body);
  }
  if (error instanceof TypeError) {
    return new CliError(error.message, ExitCode.connection);
  }
  return new CliError(error instanceof Error ? error.message : String(error), ExitCode.validation);
}
