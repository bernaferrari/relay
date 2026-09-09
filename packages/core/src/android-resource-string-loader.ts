import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { androidBaseApkPath } from "./android-app-locales.js";
import { parseAndroidLocaleOutput } from "./android-locale-tags.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";
import {
  createAndroidResourceStringIndex,
  type AndroidResourceStringIndexOptions,
} from "./android-resource-strings.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 64 * 1024 * 1024;

export function androidApkPaths(packagePaths: string): string[] {
  return packagePaths
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:/") && line.endsWith(".apk"))
    .map((line) => line.slice("package:".length));
}

export interface AndroidResourceStringLoaderOptions extends Omit<
  AndroidResourceStringIndexOptions,
  "targetLocale"
> {
  targetLocale?: string;
  /** Test seam; production uses adb resolved from the Android SDK. */
  command?: (executable: string, args: string[]) => Promise<{ stdout?: string; stderr?: string }>;
}

export async function loadAndroidResourceStringIndex(
  serial: string,
  packageName: string,
  options: AndroidResourceStringLoaderOptions,
) {
  if (!serial.trim()) throw new Error("device serial is required");
  if (!/^[A-Za-z0-9._-]+$/.test(packageName))
    throw new Error("app package name contains unsupported characters");
  const adb = await resolveAndroidSdkTool("adb");
  const aapt2 = await resolveAndroidSdkTool("aapt2");
  const command =
    options.command ??
    ((executable, args) =>
      execFileAsync(executable, args, { maxBuffer: MAX_OUTPUT, timeout: 180_000 }));
  const localeResult = await command(adb, [
    "-s",
    serial,
    "shell",
    "cmd",
    "locale",
    "get-app-locales",
    packageName,
  ]).catch(() => ({ stdout: "" }));
  const appLocale = parseAndroidLocaleOutput(String(localeResult.stdout ?? ""));
  const systemLocaleResult = appLocale
    ? undefined
    : await command(adb, ["-s", serial, "shell", "cmd", "locale", "get-device-locale"]).catch(
        () => ({ stdout: "" }),
      );
  const currentAppLocale =
    appLocale ?? parseAndroidLocaleOutput(String(systemLocaleResult?.stdout ?? ""));
  const targetLocale = options.targetLocale?.trim() || currentAppLocale;
  if (!targetLocale) return undefined;
  const workspace = await mkdtemp(path.join(tmpdir(), "relay-resource-strings-"));
  const apk = path.join(workspace, "base.apk");
  try {
    const packageResult = await command(adb, ["-s", serial, "shell", "pm", "path", packageName]);
    const packagePaths = androidApkPaths(String(packageResult.stdout ?? ""));
    const remoteApk = androidBaseApkPath(String(packageResult.stdout ?? ""));
    if (!remoteApk) throw new Error(`${packageName} is not installed on ${serial}`);
    const resourceDumps: string[] = [];
    let splitIndex = 0;
    for (const remotePath of packagePaths) {
      const localApk =
        remotePath === remoteApk ? apk : path.join(workspace, `split-${++splitIndex}.apk`);
      await command(adb, ["-s", serial, "pull", remotePath, localApk]);
      const resourcesResult = await command(aapt2, ["dump", "resources", localApk]);
      resourceDumps.push(String(resourcesResult.stdout ?? ""));
    }
    const resources = resourceDumps.join("\n");
    return {
      packageName,
      index: createAndroidResourceStringIndex(resources, {
        ...options,
        targetLocale,
      }),
      currentAppLocale,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
