import type { IosMutationAttemptDiagnosticDto } from "./operation-map.js";
import { boolean, fail, number, record, string } from "./operation-parser-primitives.js";

export function assertIosMutationAttemptDiagnostic(
  value: unknown,
  label: string,
): asserts value is IosMutationAttemptDiagnosticDto {
  const diagnostic = record(value, label);
  const sequence = number(diagnostic.sequence, `${label} sequence`);
  if (!Number.isInteger(sequence) || sequence < 1) {
    fail(`${label} sequence`, "must be a positive integer");
  }
  string(diagnostic.operation, `${label} operation`);
  if (diagnostic.nativeAttempts !== 1) fail(`${label} nativeAttempts`, "must be exactly one");
  if (
    diagnostic.outcome !== "completed" &&
    diagnostic.outcome !== "selector-miss" &&
    diagnostic.outcome !== "selector-rejected" &&
    diagnostic.outcome !== "outcome-unknown"
  ) {
    fail(`${label} outcome`, "is unsupported");
  }
  const retry = record(diagnostic.retry, `${label} retry`);
  if (retry.attempts !== 0) fail(`${label} retry attempts`, "must be zero");
  if (
    retry.decision !== "not-needed" &&
    retry.decision !== "safe-selector-fallback" &&
    retry.decision !== "blocked"
  ) {
    fail(`${label} retry decision`, "is unsupported");
  }
  if (
    retry.reason !== "native-command-completed" &&
    retry.reason !== "selector-was-not-dispatched" &&
    retry.reason !== "native-selector-rejected" &&
    retry.reason !== "native-command-outcome-unknown"
  ) {
    fail(`${label} retry reason`, "is unsupported");
  }
  const intervention = record(diagnostic.intervention, `${label} intervention`);
  boolean(intervention.required, `${label} intervention required`);
  if (
    intervention.action !== "none" &&
    intervention.action !== "capture-current-screen-before-any-retry"
  ) {
    fail(`${label} intervention action`, "is unsupported");
  }
  if (diagnostic.cancellation !== undefined) {
    const cancellation = record(diagnostic.cancellation, `${label} cancellation`);
    if (cancellation.observedAfterAttemptStarted !== true) {
      fail(`${label} cancellation observedAfterAttemptStarted`, "must be true");
    }
  }
  number(diagnostic.at, `${label} at`);
}
