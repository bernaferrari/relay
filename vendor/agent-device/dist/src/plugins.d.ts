import { G as AppError, K as AppErrorCode, q as AppErrorDetails } from "./sdk-contracts.js";
//#region src/sdk/plugins.d.ts
type ProviderPluginHost = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  options: Readonly<Record<string, unknown>>;
  clientVersion: string;
  createError(code: AppErrorCode, message: string, details?: AppErrorDetails): AppError;
}>;
//#endregion
export { ProviderPluginHost };