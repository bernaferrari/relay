import { t as AppsFilter } from "./app-inventory.js";
import { a as readAndroidClipboardWithAdb, c as AndroidAdbExecutor, d as AndroidPortReverseEndpoint, f as AndroidPortReverseProvider, i as getAndroidKeyboardStatusWithAdb, l as AndroidAdbExecutorOptions, n as AndroidKeyboardState, o as writeAndroidClipboardWithAdb, r as dismissAndroidKeyboardWithAdb, t as AndroidKeyboardDismissResult, u as AndroidAdbProvider } from "./device-input-state.js";
//#region packages/platform-android/src/adb-port-reverse.d.ts
declare function createAndroidPortReverseManager(provider: AndroidAdbProvider | AndroidAdbExecutor): AndroidPortReverseProvider;
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
export { type AndroidAdbExecutor, type AndroidAdbExecutorOptions, type AndroidAdbProvider, type AndroidKeyboardDismissResult, type AndroidKeyboardState, type AndroidPortReverseEndpoint, captureAndroidLogcatWithAdb, createAndroidPortReverseManager, dismissAndroidKeyboardWithAdb, forceStopAndroidAppWithAdb, getAndroidAppStateWithAdb, getAndroidKeyboardStatusWithAdb, listAndroidAppsWithAdb, openAndroidAppWithAdb, readAndroidClipboardWithAdb, writeAndroidClipboardWithAdb };