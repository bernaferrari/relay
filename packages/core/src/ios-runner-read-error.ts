import type { LiveIosRunnerCommandResult } from "./ios-runner-listener-command.js";

const READ_FAILURE_CODES = new Set([
  "MAIN_THREAD_TIMEOUT",
  "ETIMEDOUT",
  "RUNNER_BUSY",
  "RUNNER_WEDGED",
  "APP_NOT_RUNNING",
  "APP_NOT_FOREGROUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
]);

/** Carry only known read-failure codes across the adopted transport. The
 * caller's controlled inspection artifact never needs raw native details. */
export class IosRunnerReadError extends Error {
  readonly code?: string;

  constructor(result: LiveIosRunnerCommandResult, message: string) {
    super(message);
    this.name = "IosRunnerReadError";
    const code = typeof result.error === "object" ? result.error?.code : undefined;
    if (typeof code === "string" && READ_FAILURE_CODES.has(code)) this.code = code;
  }
}
