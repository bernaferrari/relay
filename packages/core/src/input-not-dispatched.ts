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

export function rethrowInputOutcomeUnknown(error: unknown): void {
  if (error instanceof InputOutcomeUnknownError) throw error;
}
