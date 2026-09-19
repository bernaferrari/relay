export class ApiError<T = unknown> extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: T,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
