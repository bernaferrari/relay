import { b as DeviceInfo } from "./sdk-contracts.js";
import { t as AppsFilter } from "./app-inventory.js";
import { a as readAndroidClipboardWithAdb, c as AndroidAdbExecutor, d as AndroidAdbProvider, f as AndroidPortReverseEndpoint, i as getAndroidKeyboardStatusWithAdb, l as AndroidAdbExecutorOptions, n as AndroidKeyboardState, o as writeAndroidClipboardWithAdb, p as AndroidPortReverseProvider, r as dismissAndroidKeyboardWithAdb, t as AndroidKeyboardDismissResult, u as AndroidAdbExecutorResult } from "./device-input-state.js";
//#region packages/platform-android/src/adb-port-reverse.d.ts
declare function createAndroidPortReverseManager(provider: AndroidAdbProvider | AndroidAdbExecutor): AndroidPortReverseProvider;
//#endregion
//#region packages/kernel/src/device-shell.d.ts
declare const shellFragmentBrand: unique symbol;
/**
 * A shell-script fragment the author wrote and quoted themselves (a pipeline, redirection, or
 * `&` background job). The device shell parses it verbatim, so every interpolated value inside
 * it must go through `shellQuote`.
 */
type ShellFragment = Readonly<{
  readonly [shellFragmentBrand]: true;
  script: string;
}>;
/** One element of a device-shell command: a value (quoted for the device shell) or a fragment. */
type ShellWord = string | number | ShellFragment;
//#endregion
//#region packages/platform-android/src/adb-provider-scope.d.ts
/** Runs `adb shell <words>` through an executor; every word is quoted for the device shell. */
declare function runAdbShell(adb: AndroidAdbExecutor, words: readonly ShellWord[], options?: AndroidAdbExecutorOptions): Promise<AndroidAdbExecutorResult>;
/** Runs `adb exec-out <words>` (raw stdout) through an executor. */
declare function runAdbExecOut(adb: AndroidAdbExecutor, words: readonly ShellWord[], options?: AndroidAdbExecutorOptions): Promise<AndroidAdbExecutorResult>;
//#endregion
//#region packages/platform-android/src/app-helpers.d.ts
type AndroidAppListFilter = AppsFilter;
type AndroidAppListTarget = 'mobile' | 'tv' | 'auto';
type AndroidAppListOptions = {
  filter?: AndroidAppListFilter;
  target?: AndroidAppListTarget;
};
declare function listAndroidAppsWithAdb$1(adb: AndroidAdbExecutor, options?: AndroidAppListOptions): Promise<Array<{
  package: string;
  name: string;
}>>;
//#endregion
//#region packages/platform-android/src/logcat.d.ts
type AndroidLogcatCaptureOptions = {
  lines?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};
declare function captureAndroidLogcatWithAdb$1(adb: AndroidAdbExecutor, options?: AndroidLogcatCaptureOptions): Promise<string>;
//#endregion
//#region packages/platform-android/src/adb.d.ts
/** Runs `adb shell <words>` for the device; every word is quoted for the device shell. */
declare function runAndroidShell(device: DeviceInfo, words: readonly ShellWord[], options?: AndroidAdbExecutorOptions): Promise<AndroidAdbExecutorResult>;
/** Runs `adb exec-out <words>` (raw stdout) for the device. */
declare function runAndroidExecOut(device: DeviceInfo, words: readonly ShellWord[], options?: AndroidAdbExecutorOptions): Promise<AndroidAdbExecutorResult>;
//#endregion
//#region packages/platform-android/src/app-control.d.ts
type AndroidOpenAppWithAdbOptions = {
  activity?: string;
  category?: string;
};
declare function forceStopAndroidAppWithAdb(adb: AndroidAdbExecutor, packageName: string): Promise<void>;
declare function openAndroidAppWithAdb(adb: AndroidAdbExecutor, packageName: string, options?: AndroidOpenAppWithAdbOptions): Promise<void>;
//#endregion
//#region packages/contracts/src/app-state-runtime.d.ts
/** Neutral foreground identity returned by a selected platform/provider runtime. */
type AppStateRuntimeResult = Readonly<{
  package?: string;
  activity?: string;
}>;
//#endregion
//#region packages/platform-android/src/mechanics.d.ts
declare function listAndroidAppsWithAdb(...args: Parameters<typeof listAndroidAppsWithAdb$1>): Promise<Awaited<ReturnType<typeof listAndroidAppsWithAdb$1>>>;
declare function captureAndroidLogcatWithAdb(...args: Parameters<typeof captureAndroidLogcatWithAdb$1>): Promise<Awaited<ReturnType<typeof captureAndroidLogcatWithAdb$1>>>;
//#endregion
//#region src/sdk/android-adb.d.ts
declare function getAndroidAppStateWithAdb(adb: AndroidAdbExecutor, signal?: AbortSignal): Promise<AppStateRuntimeResult>;
//#endregion
export { type AndroidAdbExecutor, type AndroidAdbExecutorOptions, type AndroidAdbProvider, type AndroidKeyboardDismissResult, type AndroidKeyboardState, type AndroidPortReverseEndpoint, type ShellWord, captureAndroidLogcatWithAdb, createAndroidPortReverseManager, dismissAndroidKeyboardWithAdb, forceStopAndroidAppWithAdb, getAndroidAppStateWithAdb, getAndroidKeyboardStatusWithAdb, listAndroidAppsWithAdb, openAndroidAppWithAdb, readAndroidClipboardWithAdb, runAdbExecOut, runAdbShell, runAndroidExecOut, runAndroidShell, writeAndroidClipboardWithAdb };