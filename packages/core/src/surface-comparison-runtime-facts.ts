import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";
import { parseAndroidLocaleOutput } from "./android-locale-tags.js";
import { captureAndroidForegroundApp } from "./android-ui-snapshot.js";
import { inspectAndroidApp, type AndroidAppBuild } from "./device.js";
import type { TestJob } from "./session-contract.js";

const execFileAsync = promisify(execFile);

export { parseAndroidLocaleOutput } from "./android-locale-tags.js";

type RuntimeFactDependencies = {
  foreground?: (serial: string) => Promise<string | undefined>;
  build?: (packageName: string) => Promise<AndroidAppBuild>;
  command?: (serial: string, args: string[]) => Promise<string>;
};

async function adb(serial: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    await resolveAndroidSdkTool("adb"),
    ["-s", serial, "shell", ...args],
    {
      timeout: 3_000,
    },
  );
  return String(stdout);
}

/** Freeze the exact facts needed to reuse immutable surface comparisons.
 * Unknown facts remain unknown so the cache continues to fail closed. */
export async function ensureAndroidSurfaceRuntimeFacts(
  job: TestJob,
  dependencies: RuntimeFactDependencies = {},
): Promise<void> {
  if (job.platform !== "android" || !job.serial) return;
  if (
    job.appVersion &&
    (job.resolvedInputs.app_locale || job.resolvedInputs.locale || job.resolvedInputs.language)
  ) {
    return;
  }
  const foreground = dependencies.foreground ?? captureAndroidForegroundApp;
  const readBuild = dependencies.build ?? inspectAndroidApp;
  const command = dependencies.command ?? adb;
  const packageName = await foreground(job.serial).catch(() => undefined);
  if (!packageName) return;

  const [build, appLocaleOutput] = await Promise.all([
    readBuild(packageName).catch(() => undefined),
    command(job.serial, ["cmd", "locale", "get-app-locales", packageName]).catch(() => ""),
  ]);
  let locale = parseAndroidLocaleOutput(appLocaleOutput);
  if (!locale) {
    locale = parseAndroidLocaleOutput(
      await command(job.serial, ["cmd", "locale", "get-device-locale"]).catch(() => ""),
    );
  }
  if (build?.versionName) {
    job.appVersion = build.versionName;
    job.resolvedInputs.app_version = build.versionName;
    job.artifacts.push({ kind: "app-build", capturedAt: Date.now(), data: build });
  }
  if (locale) job.resolvedInputs.app_locale = locale;
}
