/**
 * Android app lifecycle over a narrow adb bridge: inspect the installed build,
 * set a per-app locale, install/update/uninstall a local APK.
 *
 * Every adb argument is a separate argv value, never an interpolated shell
 * string, and the results become immutable run evidence rather than test state.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  androidLocaleTagCandidates,
  androidLocaleTagsCompatible,
  parseAndroidLocaleOutput,
} from "./android-locale-tags.js";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  raceCancel,
  throwIfCancelled,
} from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { selectedPlatform, targetIdentity } from "./target-context.js";

const execFileAsync = promisify(execFile);

const ANDROID_PACKAGE_NAME = /^[A-Za-z0-9._-]+$/;
const BCP_47_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export type AndroidAppBuild = {
  packageName: string;
  installed: boolean;
  versionName?: string;
  versionCode?: string;
};

function androidAdbArgs(args: string[]): string[] {
  return ["-s", targetIdentity(), ...args];
}

function mutateCurrentTarget<T>(operation: () => Promise<T>): Promise<T> {
  return runTargetMutation(targetIdentity(), getExecutingJobId(), operation);
}

function requireAndroidBuildControl(packageName: string): void {
  if (selectedPlatform() !== "android") {
    throw new Error(
      "capability unavailable: app build inspection and APK installation currently require Android",
    );
  }
  if (!ANDROID_PACKAGE_NAME.test(packageName)) {
    throw new Error("app package name contains unsupported characters");
  }
}

/** Parse the stable fields from `adb shell dumpsys package`. Exported so the
 * evidence reader remains testable without a connected device. */
export function parseAndroidAppBuild(packageName: string, output: string): AndroidAppBuild {
  const versionName = output.match(/\bversionName=([^\s]+)/)?.[1];
  const versionCode = output.match(/\bversionCode=(\d+)/)?.[1];
  return {
    packageName,
    installed: Boolean(versionName || versionCode || output.includes(`Package [${packageName}]`)),
    ...(versionName ? { versionName } : {}),
    ...(versionCode ? { versionCode } : {}),
  };
}

/** Inspect the build that is really installed on the selected Android device. */
export async function inspectAndroidApp(packageName: string): Promise<AndroidAppBuild> {
  requireAndroidBuildControl(packageName);
  await cooperativeCheckpoint();
  throwIfCancelled();
  try {
    const { stdout } = await raceCancel(
      execFileAsync("adb", androidAdbArgs(["shell", "dumpsys", "package", packageName])),
    );
    return parseAndroidAppBuild(packageName, String(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unknown package|not found|does not exist|can't find/i.test(message)) {
      return { packageName, installed: false };
    }
    throw error;
  }
}

export type AndroidAdbCommand = (args: string[]) => Promise<{ stdout?: string; stderr?: string }>;

export type SetAndroidAppLocaleOptions = {
  /** Test seam. Production talks to the selected device through adb. */
  command?: AndroidAdbCommand;
  /** Optional accessibility-tree language. Tests fake this; production can omit it. */
  readTreeLanguage?: () => Promise<string | undefined>;
};

function defaultAdbCommand(args: string[]): Promise<{ stdout?: string; stderr?: string }> {
  return execFileAsync("adb", androidAdbArgs(args));
}

async function readAppLocale(
  command: AndroidAdbCommand,
  packageName: string,
): Promise<string | undefined> {
  try {
    const result = await command(["shell", "cmd", "locale", "get-app-locales", packageName]);
    return parseAndroidLocaleOutput(String(result.stdout ?? ""));
  } catch {
    return undefined;
  }
}

function observedLocaleMatches(
  observed: string | undefined,
  requested: string,
): boolean | undefined {
  if (!observed?.trim()) return undefined;
  return androidLocaleTagsCompatible(observed, requested);
}

/** Set one app's locale through Android's public LocaleManager shell surface.
 * When the requested tag fails or the observed language does not change,
 * retry the product-owned he/iw and id/in aliases. */
export async function setAndroidAppLocale(
  packageName: string,
  locale: string,
  options: SetAndroidAppLocaleOptions = {},
): Promise<void> {
  requireAndroidBuildControl(packageName);
  if (!BCP_47_TAG.test(locale)) {
    throw new Error(`app locale is not a BCP-47 language tag: ${locale}`);
  }
  await cooperativeCheckpoint();
  throwIfCancelled();
  const command = options.command ?? defaultAdbCommand;
  const beforeLocale = await readAppLocale(command, packageName);
  const beforeTree = await options.readTreeLanguage?.();
  let lastError: Error | undefined;
  for (const tag of androidLocaleTagCandidates(locale)) {
    try {
      await mutateCurrentTarget(() =>
        raceCancel(
          command(["shell", "cmd", "locale", "set-app-locales", packageName, "--locales", tag]),
        ),
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
    const afterLocale = await readAppLocale(command, packageName);
    const afterTree = await options.readTreeLanguage?.();
    const localeMatch = observedLocaleMatches(afterLocale, locale);
    const treeMatch = observedLocaleMatches(afterTree, locale);
    if (localeMatch === true || treeMatch === true) return;
    const localeUnchanged =
      afterLocale !== undefined &&
      beforeLocale !== undefined &&
      androidLocaleTagsCompatible(afterLocale, beforeLocale) &&
      !androidLocaleTagsCompatible(afterLocale, locale);
    const treeUnchanged =
      afterTree !== undefined &&
      beforeTree !== undefined &&
      androidLocaleTagsCompatible(afterTree, beforeTree) &&
      !androidLocaleTagsCompatible(afterTree, locale);
    if (localeMatch === false || treeMatch === false || localeUnchanged || treeUnchanged) {
      lastError = new Error(
        `app locale ${locale} did not take` + (tag !== locale ? ` (tried ${tag})` : ""),
      );
      continue;
    }
    return;
  }
  throw lastError ?? new Error(`app locale ${locale} did not take`);
}

/** Install, update, or uninstall a known local Android APK. iOS and browser
 * targets fail explicitly instead of pretending those lifecycle operations
 * are portable. */
export async function changeAndroidAppBuild(input: {
  action: "install" | "update" | "uninstall";
  packageName: string;
  artifact?: string;
}): Promise<AndroidAppBuild> {
  const { action, packageName, artifact } = input;
  requireAndroidBuildControl(packageName);
  const trimmedArtifact = artifact?.trim();
  if (action !== "uninstall" && !trimmedArtifact) {
    throw new Error(`${action} requires a local APK artifact path`);
  }
  await cooperativeCheckpoint();
  throwIfCancelled();
  if (action === "uninstall") {
    await mutateCurrentTarget(() =>
      raceCancel(execFileAsync("adb", androidAdbArgs(["uninstall", packageName]))),
    );
    return { packageName, installed: false };
  }
  const args =
    action === "update" ? ["install", "-r", trimmedArtifact!] : ["install", trimmedArtifact!];
  await mutateCurrentTarget(() => raceCancel(execFileAsync("adb", androidAdbArgs(args))));
  return await inspectAndroidApp(packageName);
}
