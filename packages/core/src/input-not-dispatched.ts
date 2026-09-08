/** Proof supplied only at a boundary before any native input has been attempted. */
export class InputNotDispatchedError extends Error {
  readonly code = "input-not-dispatched";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InputNotDispatchedError";
  }
}
