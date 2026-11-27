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
  androidAppLocaleListArgument,
  normalizeAndroidLocaleTags,
  prefetchAndroidLanguageSplits,
} from "./android-play-language-splits.js";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  JobCancelledError,
  raceCancel,
  throwIfCancelled,
} from "../execution/control.js";
import { runTargetMutation } from "../target/target-control.js";
import { selectedPlatform, targetIdentity } from "../target/target-context.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";

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

async function execAndroidAdb(args: string[]) {
  return execFileAsync(await resolveAndroidSdkTool("adb"), args);
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
      execAndroidAdb(androidAdbArgs(["shell", "dumpsys", "package", packageName])),
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
  /** Locales the app declares. Omit to discover them from the installed APK.
   * Empty, or discovery failure, keeps today's single-tag write. */
  declaredLocales?: readonly string[];
  /** Test seam for APK locale discovery. Production uses listAndroidAppLocales. */
  discoverDeclaredLocales?: () => Promise<readonly string[] | undefined>;
  /** Play language-split poll budget. Defaults to 90s. */
  languageSplitTimeoutMs?: number;
  /** Test seam. Defaults to 1s between `pm path` reads. */
  languageSplitPollMs?: number;
  /** Test seam for the language-split poll clock. */
  now?: () => number;
  /** Test seam for the language-split poll wait. */
  sleep?: (ms: number) => Promise<void>;
};

function defaultAdbCommand(args: string[]): Promise<{ stdout?: string; stderr?: string }> {
  return execAndroidAdb(androidAdbArgs(args));
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

function usableDeclaredLocales(tags: readonly string[] | undefined): string[] | undefined {
  const locales = normalizeAndroidLocaleTags(tags).filter((tag) => BCP_47_TAG.test(tag));
  return locales.length > 0 ? locales : undefined;
}

/** Declared locales come from the caller, a test hook, or the installed APK.
 * A supplied adb command is the unit-test seam and must not pull a real APK.
 * Discovery failure skips prefetch; it does not fail the locale write. */
async function resolveDeclaredLocales(
  packageName: string,
  options: SetAndroidAppLocaleOptions,
): Promise<string[] | undefined> {
  try {
    if (options.declaredLocales !== undefined) {
      return usableDeclaredLocales(options.declaredLocales);
    }
    if (options.discoverDeclaredLocales) {
      return usableDeclaredLocales(await options.discoverDeclaredLocales());
    }
    if (options.command) return undefined;
    // listAndroidAppLocales imports this setter; keep the cycle off the load path.
    const { listAndroidAppLocales } = await import("./android-app-locales.js");
    const listed = await listAndroidAppLocales(targetIdentity(), packageName);
    return usableDeclaredLocales(listed.locales);
  } catch (error) {
    if (error instanceof JobCancelledError) throw error;
    return undefined;
  }
}

/** Set one app's locale through Android's public LocaleManager shell surface.
 * When the app declares locales, missing Play language splits are downloaded
 * first and every declared tag stays in the write — a single tag lets Play
 * delete the other splits. Alias retries still try he/iw and id/in, each in
 * front of that list. With no declared list the write stays one tag. Resolves
 * with the locale Android reported back after the change (undefined when only
 * the accessibility-tree language could prove it) and rejects when it never
 * took. Does not force-stop the app or change the device locale list. */
export async function setAndroidAppLocale(
  packageName: string,
  locale: string,
  options: SetAndroidAppLocaleOptions = {},
): Promise<string | undefined> {
  requireAndroidBuildControl(packageName);
  if (!BCP_47_TAG.test(locale)) {
    throw new Error(`app locale is not a BCP-47 language tag: ${locale}`);
  }
  await cooperativeCheckpoint();
  throwIfCancelled();
  const command = options.command ?? defaultAdbCommand;
  const declared = await resolveDeclaredLocales(packageName, options);
  throwIfCancelled();
  const beforeLocale = await readAppLocale(command, packageName);
  const beforeTree = await options.readTreeLanguage?.();
  if (declared?.length) {
    await prefetchAndroidLanguageSplits({
      packageName,
      requestedLocale: locale,
      declaredLocales: declared,
      command,
      currentLocale: beforeLocale,
      timeoutMs: options.languageSplitTimeoutMs,
      pollMs: options.languageSplitPollMs,
      now: options.now,
      sleep: options.sleep,
    });
  }
  let lastError: Error | undefined;
  for (const tag of androidLocaleTagCandidates(locale)) {
    try {
      await mutateCurrentTarget(() =>
        raceCancel(
          command([
            "shell",
            "cmd",
            "locale",
            "set-app-locales",
            packageName,
            "--locales",
            androidAppLocaleListArgument(tag, declared),
          ]),
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
    if (localeMatch === true || treeMatch === true) return afterLocale ?? afterTree;
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
    lastError = new Error(
      `app locale ${locale} could not be observed` + (tag !== locale ? ` (tried ${tag})` : ""),
    );
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
      raceCancel(execAndroidAdb(androidAdbArgs(["uninstall", packageName]))),
    );
    return { packageName, installed: false };
  }
  const args =
    action === "update" ? ["install", "-r", trimmedArtifact!] : ["install", trimmedArtifact!];
  await mutateCurrentTarget(() => raceCancel(execAndroidAdb(androidAdbArgs(args))));
  return await inspectAndroidApp(packageName);
}
