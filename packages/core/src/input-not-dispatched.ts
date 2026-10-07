import type { AndroidTextEntryReceipt } from "./android-text-entry-verification.js";

/** Proof supplied only at a boundary before any native input has been attempted. */
export class InputNotDispatchedError extends Error {
  readonly code: string = "input-not-dispatched";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InputNotDispatchedError";
  }
}

/** A native mutation may have been accepted before its acknowledgement was lost. */
export class InputOutcomeUnknownError extends Error {
  readonly code = "input-outcome-unknown";
  constructor(message: string, options?: ErrorOptions) {
    super(`Input outcome unknown: ${message}`, options);
    this.name = "InputOutcomeUnknownError";
  }
}

/** A previously readable native input no longer matches its requested entry. */
export class NativeTextEntryVerificationError extends Error {
  readonly code = "text-entry-unverified";
  constructor(
    message: string,
    readonly textEntry?: AndroidTextEntryReceipt,
  ) {
    super(`Text entry verification failed: ${message}. Relay stopped before continuing.`);
    this.name = "NativeTextEntryVerificationError";
  }
}

export function isTerminalInputError(
  error: unknown,
): error is InputOutcomeUnknownError | NativeTextEntryVerificationError {
  return (
    error instanceof InputOutcomeUnknownError || error instanceof NativeTextEntryVerificationError
  );
}

export function rethrowInputOutcomeUnknown(error: unknown): void {
  if (isTerminalInputError(error)) throw error;
}
