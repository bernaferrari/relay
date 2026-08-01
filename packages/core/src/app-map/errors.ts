import type { AppMapErrorCode } from "./model.js";

export class AppMapDomainError extends Error {
  readonly code: AppMapErrorCode;

  constructor(code: AppMapErrorCode, message: string) {
    super(message);
    this.name = "AppMapDomainError";
    this.code = code;
  }
}

export function appMapFail(code: AppMapErrorCode, message: string): never {
  throw new AppMapDomainError(code, message);
}
