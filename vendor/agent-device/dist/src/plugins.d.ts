import { G as AppErrorDetails, U as AppError, W as AppErrorCode } from "./sdk-contracts.js";
//#region src/sdk/plugins.d.ts
type ProviderPluginHost = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  options: Readonly<Record<string, unknown>>;
  createError(code: AppErrorCode, message: string, details?: AppErrorDetails): AppError;
}>;
//#endregion
export { ProviderPluginHost };