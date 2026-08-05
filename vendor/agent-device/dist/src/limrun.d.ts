import { B as DeviceTarget, D as Rect, E as RawSnapshotNode, H as PlatformSelector, R as DeviceInfo, T as Point, f as LeaseBackend, j as SnapshotOptions$1, k as SnapshotBackend } from "./sdk-contracts.js";
import { c as ScrollDirection, o as GesturePlan, r as AndroidAdbProvider } from "./sdk-android-adb.js";
import { a as BackendSnapshotResult, d as DeviceRotation, f as BackMode, l as SessionSurface, n as CloudArtifactProvider, u as TvRemoteButton } from "./cloud-artifacts.js";
import { t as AppsFilter } from "./app-inventory.js";
import { n as AndroidKeyboardState, s as AndroidInputOwner, t as AndroidKeyboardDismissResult } from "./device-input-state.js";
import Limrun from "@limrun/api";
import "@limrun/api/instance-client";
import "@limrun/api/ios-client";
//#region packages/contracts/src/settings.d.ts
type SettingOptions = {
  permissionTarget?: string;
  permissionMode?: string;
  latitude?: number;
  longitude?: number;
};
//#endregion
//#region packages/contracts/src/runner-lease-context.d.ts
type RunnerLogicalLeaseContext = {
  leaseId?: string;
  clientId?: string;
  tenantId?: string;
  runId?: string;
  leaseProvider?: string;
  deviceKey?: string;
};
//#endregion
//#region packages/contracts/src/interactor-types.d.ts
type RunnerContext = {
  requestId?: string;
  signal?: AbortSignal;
  appBundleId?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  iosXctestrunFile?: string;
  iosXctestDerivedDataPath?: string;
  iosXctestEnvDir?: string;
  runnerLeaseContext?: RunnerLogicalLeaseContext;
};
type ScreenshotOptions = {
  appBundleId?: string;
  pixelDensity?: number;
  fullscreen?: boolean;
  normalizeStatusBar?: boolean;
  stabilize?: boolean;
  surface?: SessionSurface;
  skipIosSimulatorBootCheck?: boolean;
  captureBackend?: 'runner';
};
type ElementSelectorKey = 'id' | 'label' | 'text' | 'value';
type ElementSelectorTapOptions = {
  key: ElementSelectorKey;
  value: string;
  allowNonHittableCoordinateFallback?: boolean;
  expectedPoint?: Point;
};
type SnapshotOptions = SnapshotOptions$1 & {
  appBundleId?: string;
  signal?: AbortSignal;
  includeRects?: boolean;
  includeHiddenContentHints?: boolean;
  surface?: SessionSurface;
};
type SnapshotResult = Omit<BackendSnapshotResult, 'backend' | 'nodes'> & {
  nodes?: RawSnapshotNode[];
  backend: Extract<SnapshotBackend, 'android' | 'xctest' | 'linux-atspi' | 'web'>;
};
type Interactor = {
  open(app: string, options?: {
    activity?: string;
    appBundleId?: string;
    launchConsole?: string;
    launchArgs?: string[];
    terminateRunningApp?: boolean;
    url?: string;
  }): Promise<void>;
  openDevice(): Promise<void>;
  close(app: string): Promise<void>;
  tap(x: number, y: number): Promise<Record<string, unknown> | void>;
  tapElementSelector?(selector: ElementSelectorTapOptions): Promise<Record<string, unknown> | void>;
  doubleTap(x: number, y: number): Promise<Record<string, unknown> | void>;
  longPress(x: number, y: number, durationMs?: number): Promise<Record<string, unknown> | void>;
  focus(x: number, y: number): Promise<Record<string, unknown> | void>;
  type(text: string, delayMs?: number): Promise<void>;
  fillElementSelector?(selector: ElementSelectorTapOptions, text: string, delayMs?: number): Promise<Record<string, unknown> | void>;
  fill(x: number, y: number, text: string, delayMs?: number): Promise<Record<string, unknown> | void>;
  scroll(direction: ScrollDirection, options?: {
    amount?: number;
    pixels?: number;
    durationMs?: number;
  }): Promise<Record<string, unknown> | void>;
  screenshot(outPath: string, options?: ScreenshotOptions): Promise<void>;
  setViewport?(width: number, height: number): Promise<Record<string, unknown> | void>;
  snapshot(options?: SnapshotOptions): Promise<SnapshotResult>;
  gestureViewport?(): Promise<Rect>;
  back(mode?: BackMode): Promise<void>;
  home(): Promise<void>;
  setOrientation(orientation: DeviceRotation): Promise<{
    orientation?: DeviceRotation;
  } | void>;
  performGesture?(plan: GesturePlan): Promise<Record<string, unknown> | void>;
  appSwitcher(): Promise<void>;
  tvRemote(button: TvRemoteButton, durationMs?: number): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  pasteClipboard?(text: string, selector: Pick<ElementSelectorTapOptions, 'key' | 'value'>): Promise<string>;
  copyClipboard?(selector: Pick<ElementSelectorTapOptions, 'key' | 'value'>, expectedText?: string): Promise<string>;
  setSetting(setting: string, state: string, appId?: string, options?: SettingOptions): Promise<Record<string, unknown> | void>;
};
//#endregion
//#region packages/contracts/src/device-inventory.d.ts
type DeviceInventoryRequest = {
  platform?: PlatformSelector;
  target?: DeviceTarget;
  deviceName?: string;
  udid?: string;
  serial?: string;
  leaseId?: string;
  leaseProvider?: string;
  deviceKey?: string;
  clientId?: string;
  iosSimulatorSetPath?: string;
  androidSerialAllowlist?: string[];
};
//#endregion
//#region packages/contracts/src/device-provider.d.ts
type DeviceLease = {
  leaseId: string;
  tenantId: string;
  runId: string;
  backend: LeaseBackend;
  leaseProvider?: string;
  deviceKey?: string;
  clientId?: string;
  createdAt: number;
  heartbeatAt: number;
  expiresAt: number;
};
type LeaseLifecycleContext = {
  flags?: Readonly<Record<string, unknown>>;
  cwd?: string;
};
type LeaseLifecycleProvider = {
  allocate?: (lease: DeviceLease, context?: LeaseLifecycleContext) => Promise<Record<string, unknown> | undefined>;
  heartbeat?: (lease: DeviceLease, context?: LeaseLifecycleContext) => Promise<Record<string, unknown> | undefined>;
  release?: (lease: DeviceLease, context?: LeaseLifecycleContext) => Promise<Record<string, unknown> | undefined>;
};
type DeviceInventoryProvider = (request: DeviceInventoryRequest) => Promise<DeviceInfo[] | null | undefined>;
//#endregion
//#region packages/contracts/src/provider-device-runtime.d.ts
type ProviderDeviceInstallResult = {
  bundleId?: string;
  packageName?: string;
  appName?: string;
  launchTarget?: string;
};
type ProviderDeviceInstallOptions = {
  relaunch?: boolean;
  appIdentifierHint?: string;
  packageNameHint?: string;
};
type ProviderPortReverseOptions = {
  leaseId: string;
  provider?: string;
  devicePort: number;
  hostPort: number;
  name: string;
};
type ProviderExpiredLeaseRecovery = (lease: DeviceLease) => Promise<void>;
/** Provider adapter contract; root owns active-runtime and request composition. */
type ProviderDeviceRuntime = {
  provider: string;
  leaseLifecycle: LeaseLifecycleProvider;
  recoverExpiredLease?: ProviderExpiredLeaseRecovery;
  cloudArtifacts?: CloudArtifactProvider;
  deviceInventoryProvider: DeviceInventoryProvider;
  ownsDevice(device: DeviceInfo): boolean;
  getInteractor(device: DeviceInfo, runnerContext?: RunnerContext): Interactor | undefined;
  installApp?(device: DeviceInfo, app: string, appPath: string, options?: ProviderDeviceInstallOptions): Promise<ProviderDeviceInstallResult | undefined>;
  installInstallablePath?(device: DeviceInfo, installablePath: string, options?: ProviderDeviceInstallOptions): Promise<ProviderDeviceInstallResult | undefined>;
  configurePortReverse?(options: ProviderPortReverseOptions): Promise<Record<string, unknown> | undefined>;
  shutdown(): Promise<void>;
};
//#endregion
//#region packages/provider-limrun/src/runtime-dependencies.d.ts
type LimrunAdbCommandOptions = {
  allowFailure?: boolean;
  binaryStdout?: boolean;
  stdin?: string | Buffer;
  timeoutMs?: number;
  signal?: AbortSignal;
};
type LimrunAdbCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutBuffer?: Buffer;
};
type LimrunAdbExecutor = (args: string[], options?: LimrunAdbCommandOptions) => Promise<LimrunAdbCommandResult>;
type LimrunPortReverseEndpoint = `tcp:${number}` | `localabstract:${string}`;
type LimrunPortReverseMapping = {
  local: LimrunPortReverseEndpoint;
  remote: LimrunPortReverseEndpoint;
  ownerId?: string;
};
type LimrunPortReverseOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};
type LimrunPortReverse = {
  ensure(mapping: LimrunPortReverseMapping, options?: LimrunPortReverseOptions): Promise<void>;
  remove(local: LimrunPortReverseEndpoint, options?: LimrunPortReverseOptions): Promise<void>;
  removeAllOwned(ownerId: string, options?: LimrunPortReverseOptions): Promise<void>;
  list?(options?: LimrunPortReverseOptions): Promise<LimrunPortReverseMapping[]>;
};
type LimrunAdbProvider = {
  exec: LimrunAdbExecutor;
  reverse?: LimrunPortReverse;
  text?: (request: {
    action: 'type' | 'fill';
    text: string;
    delayMs?: number;
    target?: {
      x: number;
      y: number;
    };
  }) => Promise<void>;
};
type LimrunAndroidKeyboardState = {
  visible: boolean;
  inputType?: string;
  type?: 'text' | 'number' | 'email' | 'phone' | 'password' | 'datetime' | 'unknown';
  inputMethodPackage?: string;
  focusedPackage?: string;
  focusedResourceId?: string;
  inputOwner: AndroidInputOwner;
};
type LimrunAndroidKeyboardDismissResult = LimrunAndroidKeyboardState & {
  attempts: number;
  wasVisible: boolean;
  dismissed: boolean;
};
//#endregion
//#region packages/provider-limrun/src/ios.d.ts
type LimrunIosRemoteInstallOptions = {
  md5?: string;
  relaunch?: boolean;
  appIdentifierHint?: string;
};
type LimrunIosRemoteInstallResult = {
  appId?: string;
};
//#endregion
//#region packages/provider-limrun/src/device-session.d.ts
type LimrunRecordingQuality = 5 | 6 | 7 | 8 | 9 | 10;
type LimrunInstalledApp = {
  id: string;
  name?: string;
  installType?: string;
};
type LimrunForegroundApp = {
  appId?: string;
  activity?: string;
};
type LimrunIosCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};
type LimrunIosCommandExecution = {
  on(event: 'line-stdout' | 'line-stderr', listener: (line: string) => void): LimrunIosCommandExecution;
  on(event: 'exit', listener: (code: number) => void): LimrunIosCommandExecution;
  on(event: 'error', listener: (error: Error) => void): LimrunIosCommandExecution;
  off(event: 'line-stdout' | 'line-stderr', listener: (line: string) => void): LimrunIosCommandExecution;
  off(event: 'exit', listener: (code: number) => void): LimrunIosCommandExecution;
  off(event: 'error', listener: (error: Error) => void): LimrunIosCommandExecution;
  wait(): Promise<LimrunIosCommandResult>;
  stop(): void;
};
type LimrunDeviceSessionBase = {
  readonly platform: 'android' | 'ios';
  readonly device: DeviceInfo;
  readonly interactor: Interactor;
  listApps(filter?: AppsFilter): Promise<LimrunInstalledApp[]>;
  pressKey(key: string, modifiers?: string[]): Promise<void>;
  startRecording(options?: {
    quality?: LimrunRecordingQuality;
  }): Promise<void>;
  stopRecording(options: {
    outPath: string;
  }): Promise<string>;
};
type LimrunAndroidDeviceSession$1 = LimrunDeviceSessionBase & {
  readonly platform: 'android';
  readonly adb: LimrunAdbProvider;
  getForegroundApp(): Promise<LimrunForegroundApp | undefined>;
  getKeyboardState(): Promise<LimrunAndroidKeyboardState>;
  dismissKeyboard(): Promise<LimrunAndroidKeyboardDismissResult>;
  readLogs(lineLimit: number): Promise<string>;
  installRemoteApp(url: string): Promise<void>;
};
type LimrunIosDeviceSession = LimrunDeviceSessionBase & {
  readonly platform: 'ios';
  readonly viewport: {
    width: number;
    height: number;
  };
  readLogs(appId: string, lineLimit: number): Promise<string>;
  installRemoteApp(url: string, options?: LimrunIosRemoteInstallOptions): Promise<LimrunIosRemoteInstallResult>;
  runSimctl(args: string[]): LimrunIosCommandExecution;
};
//#endregion
//#region packages/provider-limrun/src/runtime.d.ts
type LimrunRuntimeOptions = {
  apiKey: string;
  region?: string;
};
//#endregion
//#region src/sdk/limrun-runtime-types.d.ts
type LimrunAndroidDeviceSession = Omit<LimrunAndroidDeviceSession$1, 'adb' | 'getKeyboardState' | 'dismissKeyboard'> & {
  readonly adb: AndroidAdbProvider;
  getKeyboardState(): Promise<AndroidKeyboardState>;
  dismissKeyboard(): Promise<AndroidKeyboardDismissResult>;
};
type LimrunDeviceSession = LimrunAndroidDeviceSession | LimrunIosDeviceSession;
//#endregion
//#region src/provider-limrun-runtime.d.ts
declare class LimrunRuntime implements ProviderDeviceRuntime {
  private readonly implementation;
  readonly provider = "limrun";
  constructor(options: LimrunRuntimeOptions);
  get leaseLifecycle(): LeaseLifecycleProvider;
  get recoverExpiredLease(): ProviderExpiredLeaseRecovery;
  get deviceInventoryProvider(): DeviceInventoryProvider;
  ownsDevice(device: DeviceInfo): boolean;
  getInteractor(device: DeviceInfo): Interactor | undefined;
  getDeviceSession(device: DeviceInfo): LimrunDeviceSession | undefined;
  installApp(device: DeviceInfo, app: string, appPath: string, options?: ProviderDeviceInstallOptions): Promise<ProviderDeviceInstallResult | undefined>;
  installInstallablePath(device: DeviceInfo, installablePath: string, options?: ProviderDeviceInstallOptions): Promise<ProviderDeviceInstallResult | undefined>;
  configurePortReverse(options: ProviderPortReverseOptions): Promise<Record<string, unknown> | undefined>;
  shutdown(): Promise<void>;
}
//#endregion
export { type LimrunAndroidDeviceSession, type LimrunDeviceSession, type LimrunIosCommandExecution, type LimrunIosDeviceSession, LimrunRuntime, type LimrunRuntimeOptions };