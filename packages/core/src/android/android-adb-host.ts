/** Execute host-side adb through the audited Android SDK resolver. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";

const execFileAsync = promisify(execFile);

export type AndroidAdbExecOptions = {
  timeout?: number;
  signal?: AbortSignal;
  maxBuffer?: number;
};

export async function execAndroidAdb(args: string[], options: AndroidAdbExecOptions = {}) {
  return execFileAsync(await resolveAndroidSdkTool("adb"), args, options);
}
