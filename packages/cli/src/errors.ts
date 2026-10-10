import { ApiError } from "@relay/client";

export const ExitCode = {
  success: 0,
  /** `relay run` / `relay ci`: a Test ran and the product did not do what it expects. */
  testFailed: 1,
  usage: 2,
  connection: 3,
  /** `relay run` / `relay ci`: Relay could not finish (device, sign-in, harness,
   * or no runnable Test). Shares 3 with connection: neither is a product verdict. */
  blocked: 3,
  auth: 4,
  /** Client-side input problems only: bad arguments, malformed payloads. */
  validation: 5,
  conflict: 6,
  cancellation: 7,
  server: 8,
  /** The operation ran on the server and reported failure (`{ ok: false }` or
   * job status `error`). Distinct from 5 so agents retry/report differently. */
  operationFailure: 9,
  /** The operation completed but required verification is incomplete: a
   * terminal run still has undecided human-review captures. Distinct from 0
   * (nothing left to decide) and 9 (the operation itself failed) so agents
   * and scripts cannot read collection success as acceptance. */
  verificationIncomplete: 10,
  /** The named App, Test, Run, or Device does not exist (also HTTP 404). */
  notFound: 11,
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
    if (error.status === 404) return new CliError(error.message, ExitCode.notFound, error.body);
    if ([400, 405, 412, 422].includes(error.status)) {
      return new CliError(error.message, ExitCode.validation, error.body);
    }
    if (error.status === 408) return new CliError(error.message, ExitCode.connection, error.body);
    if (error.status === 499) return new CliError(error.message, ExitCode.cancellation, error.body);
    if (/no active session|run open first/i.test(error.message)) {
      return new CliError(
        "No XCTest session. Point taps use CoreDevice HID over the go-ios tunnel (info port 28100 or 60105) and do not need the runner. Recover only if you need the accessibility tree. Do not run target.open on a physical iPad.",
        ExitCode.server,
        error.body,
      );
    }
    return new CliError(error.message, ExitCode.server, error.body);
  }
  if (error instanceof TypeError) {
    const raw = error.message;
    if (/fetch failed/i.test(raw)) {
      return new CliError(
        "Relay is unreachable (fetch failed). tsx watch may have restarted :8787 and dropped in-memory jobs. Do not recover-kill a live iOS runner. Do not start a new server while a Plan is live.",
        ExitCode.connection,
      );
    }
    return new CliError(raw, ExitCode.connection);
  }
  return new CliError(error instanceof Error ? error.message : String(error), ExitCode.validation);
}
