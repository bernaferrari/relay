import { B as SnapshotVisibility, D as IosTargetActivation, E as AppleApplicationState, G as DaemonError, J as NormalizedError, L as SnapshotQualityVerdict, M as SnapshotCommandOptionFields, N as SnapshotKeyboardBandFact, P as SnapshotNode, S as DeviceTarget, T as PublicPlatform, _ as SessionIsolationMode, a as DaemonRequest, f as LeaseBackend, g as ResponseLevel, i as DaemonLockPolicy, m as NetworkIncludeMode, o as DaemonResponse, r as DaemonInstallSource, s as DaemonResponseData, t as DaemonArtifact, v as SessionRuntimeHints, w as PlatformSelector, x as DeviceKind, y as AppleOS, z as SnapshotUnchanged } from "./sdk-contracts.js";
import { n as GesturePointerCount, s as AppsFilter } from "./gesture-plan-types.js";
import { C as TransformGestureParams, D as ScreenshotResultData, E as FindLocator, O as SnapshotDiagnosticsSummary, S as SwipePreset, a as FoldPose, b as ScrollInputDirection, c as MACOS_PERMISSION_TARGETS, d as PermissionMode, g as AgentArtifactsResult, h as TextSizeCategory, i as DeviceRotation, k as SessionSurface, l as MOBILE_PERMISSION_TARGETS, o as SetFoldPoseInput, r as TvRemoteButton, s as BackMode, t as ScrollCommandResult, u as PermissionAction, v as CloudProviderSessionResult, w as AndroidSnapshotBackendMetadata, x as SwipePattern, y as ScrollDirection } from "./scroll-command.js";
import { a as RemoteConnectionProfileFields, c as MetroPrepareResult, i as CloudProviderProfileFields, l as MetroReloadOptions, s as MetroPrepareOptions, u as MetroReloadResult } from "./sdk-remote-config.js";
import { _ as SettleObservation, d as ClickCommandResponseData, f as FillCommandResponseData, g as PressCommandResponseData, h as LongPressCommandResponseData, m as HoverCommandResponseData, p as FindCommandResponseData, v as ClickButton } from "./sdk-selectors.js";
import { t as BatchRunResult } from "./sdk-batch-runner.js";
//#region packages/contracts/src/json.d.ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = {
  [key: string]: JsonValue;
};
declare function isRecord(value: unknown): value is Record<string, unknown>;
//#endregion
//#region packages/contracts/src/target-shutdown-contract.d.ts
type TargetShutdownResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: NormalizedError;
};
//#endregion
//#region packages/contracts/src/client-connection.d.ts
type AgentDeviceDaemonTransportContext = {
  authToken?: string;
};
type AgentDeviceDaemonTransport = (req: Omit<DaemonRequest, 'token'>, context?: AgentDeviceDaemonTransportContext) => Promise<DaemonResponse>;
type AgentDeviceClientConfig = RemoteConnectionProfileFields & CloudProviderProfileFields & {
  session?: string;
  lockPolicy?: DaemonLockPolicy;
  lockPlatform?: PlatformSelector;
  requestId?: string;
  sessionIsolation?: SessionIsolationMode;
  leaseBackend?: LeaseBackend;
  leaseTtlMs?: number;
  runtime?: SessionRuntimeHints;
  cwd?: string;
  debug?: boolean;
  cost?: boolean;
  responseLevel?: ResponseLevel;
  iosXctestrunFile?: string;
  iosXctestDerivedDataPath?: string;
  iosXctestEnvDir?: string;
};
type AgentDeviceRequestOverrides = Pick<AgentDeviceClientConfig, 'session' | 'lockPolicy' | 'lockPlatform' | 'requestId' | 'daemonBaseUrl' | 'daemonAuthToken' | 'daemonTransport' | 'daemonServerMode' | 'tenant' | 'sessionIsolation' | 'runId' | 'leaseId' | 'leaseBackend' | 'leaseProvider' | 'deviceKey' | 'clientId' | 'providerApp' | 'providerOsVersion' | 'providerProject' | 'providerBuild' | 'providerSessionName' | 'providerDeviceOrientation' | 'providerGeoLocation' | 'providerTimezone' | 'providerAppiumVersion' | 'providerLanguage' | 'providerLocale' | 'providerNetworkProfile' | 'providerCustomNetwork' | 'providerNoResignApp' | 'awsProjectArn' | 'awsDeviceArn' | 'awsAppArn' | 'awsRegion' | 'awsInteractionMode' | 'leaseTtlMs' | 'cwd' | 'debug' | 'cost' | 'responseLevel' | 'iosXctestrunFile' | 'iosXctestDerivedDataPath' | 'iosXctestEnvDir'>;
type AgentDeviceIdentifiers = {
  session?: string;
  deviceId?: string;
  deviceName?: string;
  udid?: string;
  serial?: string;
  appId?: string;
  appBundleId?: string;
  package?: string;
};
type AgentDeviceSelectionOptions = {
  platform?: PlatformSelector;
  target?: DeviceTarget;
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
};
type DeviceCommandBaseOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions;
//#endregion
//#region packages/contracts/src/client-device-view.d.ts
type AgentDeviceDevice = {
  platform: PublicPlatform;
  target: DeviceTarget;
  kind: DeviceKind;
  id: string;
  name: string;
  booted?: boolean;
  /**
   * Additive Apple-OS discriminant (iPhone/iPad/tvOS/visionOS/macOS). Present only for
   * Apple devices; `platform` still carries the leaf (`ios`/`macos`).
   */
  appleOs?: AppleOS;
  identifiers: AgentDeviceIdentifiers;
  /**
   * Present when a host-local device claim currently blocks foreign use of
   * this device (#1320). Provably dead owners are not projected — the next
   * open reconciles and replaces them automatically.
   */
  claimedBy?: {
    session: string;
    workspace: string;
  };
  ios?: {
    udid: string;
  };
  android?: {
    serial: string;
  };
  harmonyos?: {
    serial: string;
  };
  vega?: {
    serial: string;
  };
};
type AgentDeviceCapabilitiesResult = {
  device: AgentDeviceDevice;
  availableCommands: string[];
};
type AgentDeviceSessionDevice = {
  platform: PublicPlatform;
  target: DeviceTarget;
  id: string;
  name: string;
  /**
   * Additive Apple-OS discriminant (iPhone/iPad/tvOS/visionOS/macOS). Present only for
   * Apple devices; `platform` still carries the leaf (`ios`/`macos`).
   */
  appleOs?: AppleOS;
  identifiers: AgentDeviceIdentifiers;
  ios?: {
    udid: string;
    simulatorSetPath?: string | null;
  };
  android?: {
    serial: string;
  };
  harmonyos?: {
    serial: string;
  };
  vega?: {
    serial: string;
  };
};
type AgentDeviceSession = {
  name: string;
  /**
   * The exact value `--session` must carry to address this session, which is not always `name`:
   * a session opened without `--session` is named `default` but stored — and addressed — as
   * `cwd:<hash>:default` (#2031/#1394). Optional only because a daemon older than the field does
   * not send it.
   */
  address?: string;
  createdAt: number;
  sessionStateDir?: string;
  runnerLogPath?: string;
  device: AgentDeviceSessionDevice;
  identifiers: AgentDeviceIdentifiers;
};
type StartupPerfSample = {
  durationMs: number;
  measuredAt: string;
  method: string;
  appTarget?: string;
  appBundleId?: string;
};
type DeviceBootOptions = DeviceCommandBaseOptions & {
  headless?: boolean;
};
type DeviceShutdownOptions = DeviceCommandBaseOptions;
//#endregion
//#region packages/contracts/src/client-app.d.ts
type DeviceSelectionReason = 'explicit-selector' | 'existing-session' | 'single-booted-local' | 'single-bootable-local' | 'single-app-installed-local' | 'preferred-local' | 'single-provider-device';
type DeviceSelectionSource = 'session' | 'local' | 'provider';
/** Deterministic device-selection evidence shared by daemon responses and the published client. */
type DeviceSelectionMetadata = {
  reason: DeviceSelectionReason;
  source: DeviceSelectionSource;
  candidateCount: number;
  /** Whether this request booted a previously stopped local virtual target during open. */
  bootOccurred: boolean;
};
type AppInstallOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  app?: string;
  appPath: string;
};
type AppDeployOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  app: string;
  appPath: string;
};
type AppDeployResult = {
  app: string;
  appPath: string;
  platform: PublicPlatform;
  appId?: string;
  bundleId?: string;
  package?: string;
  identifiers: AgentDeviceIdentifiers;
};
type AppOpenOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  app?: string;
  url?: string;
  surface?: SessionSurface;
  activity?: string;
  launchConsole?: string;
  launchArgs?: string[];
  relaunch?: boolean;
  /** Startup budget in milliseconds: bounds the Simulator boot wait on a cold device. */
  timeoutMs?: number;
  /**
   * Block this open for up to n milliseconds (100-120000) while another session holds the device,
   * then fail with DEVICE_IN_USE naming that session. Only session contention is waited for: a
   * device claim held by another workspace is refused at once with its recovery command. A device
   * that never frees, or is taken again while this open waits, costs the full budget, which
   * extends this command's timeout envelope rather than eating into it.
   */
  waitMs?: number;
  /**
   * Include an initial interactive snapshot in a fresh open response. With no
   * app argument, discover the sole running app on the sole booted iOS
   * simulator; ambiguous environments fail closed.
   */
  foreground?: boolean;
  saveScript?: boolean | string;
  /** #1258: overwrite an existing --save-script target instead of refusing. Alias: --overwrite. */
  force?: boolean;
  testIme?: boolean;
  noRecord?: boolean;
  runtime?: SessionRuntimeHints;
};
type AppOpenResult = {
  session: string;
  warnings?: string[];
  sessionStateDir?: string;
  runnerLogPath?: string;
  requestLogPath?: string;
  eventLogPath?: string;
  appName?: string;
  appBundleId?: string;
  appId?: string;
  startup?: StartupPerfSample;
  runtime?: SessionRuntimeHints;
  selection?: DeviceSelectionMetadata;
  device?: AgentDeviceSessionDevice;
  /**
   * Initial interactive snapshot captured immediately after an open that
   * requested `foreground`, composed from the same snapshot-runtime dispatch
   * `agent-device snapshot -i` uses. It stays loosely typed rather than reusing
   * `CaptureSnapshotResult` because the daemon-side composition does not attach
   * client-only fields like `identifiers`.
   */
  snapshot?: Record<string, unknown>;
  /**
   * open --foreground: present when the session opened successfully but the
   * composed initial snapshot capture failed. Carries the FULL daemon error
   * shape (code, message, hint, details, diagnosticId, logPath) so recovery
   * guidance survives to the caller; the session itself is open and usable —
   * a `warnings` entry says so and points at `snapshot -i`.
   */
  initialSnapshotError?: DaemonError;
  identifiers: AgentDeviceIdentifiers;
};
type AppCloseOptions = AgentDeviceRequestOverrides & {
  app?: string;
  shutdown?: boolean;
  saveScript?: boolean | string;
  /** #1258: overwrite an existing --save-script target instead of refusing. Alias: --overwrite. */
  force?: boolean;
};
type AppCloseResult = {
  session: string;
  closedApp?: string;
  shutdown?: TargetShutdownResult;
  /**
   * #1258: absolute path of the committed session/healed script when this close
   * published one (`close --save-script`, or a repair-armed session's finalize)
   * — so a client that requested publication learns where the file landed.
   */
  savedScript?: string;
  identifiers: AgentDeviceIdentifiers;
};
type AppInstallFromSourceOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  source: DaemonInstallSource;
  retainPaths?: boolean;
  retentionMs?: number;
};
type AppInstallFromSourceResult = {
  appName?: string;
  appId?: string;
  bundleId?: string;
  packageName?: string;
  launchTarget: string;
  installablePath?: string;
  archivePath?: string;
  materializationId?: string;
  materializationExpiresAt?: string;
  identifiers: AgentDeviceIdentifiers;
};
type AppListOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  appsFilter?: AppsFilter;
};
type AppPushOptions = DeviceCommandBaseOptions & {
  app: string;
  payload: string | JsonObject;
};
type AppTriggerEventOptions = DeviceCommandBaseOptions & {
  event: string;
  payload?: JsonObject;
};
type MaterializationReleaseOptions = AgentDeviceRequestOverrides & {
  materializationId: string;
};
type MaterializationReleaseResult = {
  released: boolean;
  materializationId: string;
  identifiers: AgentDeviceIdentifiers;
};
//#endregion
//#region packages/contracts/src/snapshot-capture-annotations.d.ts
type SnapshotCaptureAnalysis = {
  rawNodeCount: number;
  maxDepth: number;
};
type SnapshotCaptureFreshness = {
  action: string;
  retryCount: number;
  staleAfterRetries: boolean;
  reason?: 'empty-interactive' | 'sharp-drop' | 'stuck-route';
};
type SnapshotCaptureAnnotations = {
  analysis?: SnapshotCaptureAnalysis;
  androidSnapshot?: AndroidSnapshotBackendMetadata;
  freshness?: SnapshotCaptureFreshness;
  quality?: SnapshotQualityVerdict;
  warnings?: string[];
  /** The Apple runner re-activated the session app while serving this capture (#2682). */
  targetActivation?: IosTargetActivation;
};
type PublicSnapshotCaptureAnnotations = Pick<SnapshotCaptureAnnotations, 'androidSnapshot' | 'warnings' | 'targetActivation'> & {
  snapshotQuality?: SnapshotQualityVerdict;
};
//#endregion
//#region packages/contracts/src/client-capture.d.ts
type CaptureSnapshotOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & Omit<SnapshotCommandOptionFields, 'customActions'> & {
  /**
   * Name the affordances an element merged away (iOS UIAccessibilityCustomAction,
   * React Native accessibilityActions) — a card whose reply/options controls are not
   * separate elements still lists them here. The names are for PLANNING, not
   * invocation: there is no API to trigger them, so reach the affordance through the
   * element detail screen, through the same control exposed as a labeled element
   * elsewhere, or by coordinates from its rect. iOS simulator only; costs one
   * accessibility round trip per merged element.
   */
  customActions?: SnapshotCommandOptionFields['customActions'];
  timeoutMs?: number;
  /**
   * #1271 stage 2 (ADR 0012 amendment): `snapshot` is observation-only and
   * excluded from a repair-armed heal by default; `record` forces it
   * through. Mutually exclusive with `noRecord`.
   */
  noRecord?: boolean;
  record?: boolean;
};
type CaptureSnapshotResult = {
  nodes: SnapshotNode[];
  /** Present only when the capture owner establishes whether the tree was truncated. */
  truncated?: boolean;
  appName?: string;
  appBundleId?: string;
  visibility?: SnapshotVisibility;
  unchanged?: SnapshotUnchanged;
  snapshotDiagnostics?: SnapshotDiagnosticsSummary;
  /**
   * The keyboard band this capture's producer measured (#2660), in the same orientation space as the
   * node rects. The acting commands read it off the session state they act with; it is published so a
   * caller can see the band a `tap_keyboard_occludes_target` refusal measured against. Absent means
   * the producer measured no band and the tap guard derived one from the tree.
   */
  keyboard?: SnapshotKeyboardBandFact;
  /**
   * Screenshot captured automatically when the semantic snapshot was sparse.
   * Remote clients receive a materialized local path through the daemon artifact channel.
   */
  fallbackScreenshotPath?: string;
  identifiers: AgentDeviceIdentifiers;
  /**
   * ADR 0014: the response-level ref-frame epoch the plain node refs were minted
   * from. A ref-issuing snapshot carries it ONCE (nodes stay plain `@e12` for the
   * token budget); pair a ref with it (`@e12~s<refsGeneration>`) before a mutation.
   */
  refsGeneration?: number;
  /**
   * Digest response view only: a capped list of `{ ref, label? }` pairs taken
   * from the full `nodes` tree so the MCP layer can still pin refs when the
   * default-level `nodes` payload is intentionally omitted.
   */
  refs?: Array<{
    ref: string;
    label?: string;
  }>;
} & PublicSnapshotCaptureAnnotations;
type CaptureScreenshotOptions = AgentDeviceRequestOverrides & {
  path?: string;
  overlayRefs?: boolean;
  /** Crop the capture to the frame of the selector resolved on the same screen. */
  cropOn?: string;
  pixelDensity?: number;
  fullscreen?: boolean;
  scale?: number;
  stabilize?: boolean;
  normalizeStatusBar?: boolean;
  surface?: SessionSurface;
};
type CaptureScreenshotResult = ScreenshotResultData & {
  path: string;
  identifiers: AgentDeviceIdentifiers;
};
type CaptureDiffOptions = DeviceCommandBaseOptions & Pick<CaptureSnapshotOptions, 'interactiveOnly' | 'depth' | 'scope' | 'raw'> & {
  kind: 'snapshot';
  out?: string;
};
type SelectorSnapshotCommandOptions = Pick<CaptureSnapshotOptions, 'depth' | 'scope' | 'raw'>;
type FindSnapshotCommandOptions = Pick<CaptureSnapshotOptions, 'depth' | 'raw'>;
//#endregion
//#region packages/contracts/src/client-target.d.ts
type PointTarget = {
  x: number;
  y: number;
  ref?: never;
  selector?: never;
  label?: never;
};
type RefTarget = {
  ref: string;
  label?: string;
  x?: never;
  y?: never;
  selector?: never;
};
type SelectorTarget = {
  selector: string;
  x?: never;
  y?: never;
  ref?: never;
  label?: never;
};
type InteractionTarget = PointTarget | RefTarget | SelectorTarget;
type ElementTarget = RefTarget | SelectorTarget;
//#endregion
//#region packages/contracts/src/client-gesture.d.ts
type RepeatedPressOptions = {
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};
/**
 * Opt-in (#1101): after the action, wait for the UI to go quiet and return the
 * settled diff vs the pre-action tree (`settle` on the result) in the same
 * response. Best-effort — never fails the action. `settleQuietMs` tunes the
 * quiet window (default 500ms); `timeoutMs` bounds the settle wait (default
 * 10s) when `settle` is true. A bare `timeoutMs` without `settle` is ignored
 * for compatibility; `settleQuietMs` still requires `settle`.
 */
type SettleCommandOptions = {
  settle?: boolean;
  settleQuietMs?: number;
  timeoutMs?: number;
};
type ClickOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & RepeatedPressOptions & SettleCommandOptions & {
  button?: ClickButton;
  /**
   * Opt-in (#1047): return cheap post-action evidence (AX digest, node counts,
   * changedFromBefore) in the response instead of requiring a follow-up
   * snapshot to confirm the action had an effect.
   */
  verify?: boolean;
};
type PressOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & RepeatedPressOptions & SettleCommandOptions & {
  verify?: boolean;
};
type LongPressOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & SettleCommandOptions & {
  durationMs?: number;
};
type HoverOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & SettleCommandOptions;
type SwipeOptions = DeviceCommandBaseOptions & {
  from: {
    x: number;
    y: number;
  };
  to: {
    x: number;
    y: number;
  };
  count?: number;
  pauseMs?: number;
  pattern?: SwipePattern;
};
type PanOptions = DeviceCommandBaseOptions & {
  x: number;
  y: number;
  dx: number;
  dy: number;
  pointerCount?: GesturePointerCount;
  durationMs?: number;
};
type DragOptions = DeviceCommandBaseOptions & {
  source: string;
  destination: string;
  sourceHoldMs?: number;
  moveMs?: number;
  destinationHoldMs?: number;
};
type FlingOptions = DeviceCommandBaseOptions & {
  direction: ScrollDirection;
  x: number;
  y: number;
  distance?: number;
};
type SwipeGestureOptions = DeviceCommandBaseOptions & {
  preset: SwipePreset;
};
type FocusOptions = DeviceCommandBaseOptions & {
  x: number;
  y: number;
};
type TypeTextOptions = DeviceCommandBaseOptions & {
  text: string;
  delayMs?: number;
};
type FillOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & SettleCommandOptions & {
  text: string;
  delayMs?: number;
  /** Publish this fill value as `${VAR}` when script recording is armed. */
  recordAs?: string;
  verify?: boolean;
};
type PinchOptions = DeviceCommandBaseOptions & {
  scale: number;
  x?: number;
  y?: number;
};
type RotateGestureOptions = DeviceCommandBaseOptions & {
  degrees: number;
  x?: number;
  y?: number;
};
type TransformGestureOptions = DeviceCommandBaseOptions & TransformGestureParams;
type ScrollOptions = DeviceCommandBaseOptions & SettleCommandOptions & {
  direction: ScrollInputDirection;
  amount?: number;
  pixels?: number;
  durationMs?: number;
  /** Repeat scroll passes until this selector is visible on screen, then stop. */
  until?: string;
};
//#endregion
//#region packages/contracts/src/client-lease.d.ts
type Lease = {
  leaseId: string;
  tenantId: string;
  runId: string;
  backend: LeaseBackend;
  leaseProvider?: string;
  deviceKey?: string;
  clientId?: string;
  createdAt?: number;
  heartbeatAt?: number;
  expiresAt?: number;
};
type LeaseOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  ttlMs?: number;
};
type LeaseAllocateOptions = LeaseOptions & {
  tenant: string;
  runId: string;
  leaseBackend?: LeaseBackend;
  leaseProvider?: string;
  provider?: string;
  deviceKey?: string;
  clientId?: string;
};
type LeaseScopedOptions = LeaseOptions & {
  tenant?: string;
  runId?: string;
  leaseId: string;
  leaseBackend?: LeaseBackend;
  leaseProvider?: string;
  provider?: string;
  deviceKey?: string;
  clientId?: string;
};
type CloudArtifactsOptions = AgentDeviceRequestOverrides & {
  provider?: string;
  providerSessionId?: string;
};
type HumanControlHoldScope = {
  backend: LeaseBackend;
  leaseProvider?: string;
  deviceKey: string;
};
type HumanControlHold = {
  id: string;
  scope: HumanControlHoldScope;
  reason?: string;
  state: 'activating' | 'active';
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
};
type HumanControlHoldOptions = {
  reason?: string;
  ttlMs?: number;
};
//#endregion
//#region packages/contracts/src/logs.d.ts
declare const LOG_ACTION_VALUES: readonly ['path', 'start', 'stop', 'doctor', 'mark', 'clear'];
type LogAction = (typeof LOG_ACTION_VALUES)[number];
//#endregion
//#region packages/contracts/src/perf.d.ts
declare const PERF_AREA_VALUES: readonly ['frames', 'memory', 'cpu', 'trace'];
declare const PERF_ACTION_VALUES: readonly ['sample', 'snapshot', 'start', 'stop', 'report'];
declare const PERF_SUBJECT_VALUES: readonly ['profile'];
declare const PERF_KIND_VALUES: readonly ['xctrace', 'simpleperf', 'perfetto', 'android-hprof', 'memgraph'];
type PerfArea = (typeof PERF_AREA_VALUES)[number];
type PerfAction = (typeof PERF_ACTION_VALUES)[number];
type PerfSubject = (typeof PERF_SUBJECT_VALUES)[number];
type PerfKind = (typeof PERF_KIND_VALUES)[number];
//#endregion
//#region packages/contracts/src/recording-export-quality.d.ts
declare const RECORDING_EXPORT_QUALITIES: readonly ['medium', 'high'];
type RecordingExportQuality = (typeof RECORDING_EXPORT_QUALITIES)[number];
//#endregion
//#region packages/contracts/src/recording-scope.d.ts
declare const RECORDING_SCOPE_VALUES: readonly ['app', 'device', 'system'];
type RecordingScope = (typeof RECORDING_SCOPE_VALUES)[number];
//#endregion
//#region packages/contracts/src/client-observability.d.ts
type PerfOptions = DeviceCommandBaseOptions & {
  /** Select focused performance evidence. */
  area: PerfArea;
  subject?: PerfSubject;
  action?: PerfAction;
  kind?: PerfKind;
  template?: string;
  out?: string;
  tracePath?: string;
};
type LogsOptions = AgentDeviceRequestOverrides & {
  action?: LogAction;
  message?: string;
  restart?: boolean;
};
type EventsOptions = AgentDeviceRequestOverrides & {
  cursor?: string;
  limit?: number;
};
type NetworkOptions = DeviceCommandBaseOptions & {
  action?: 'dump' | 'log';
  limit?: number;
  include?: NetworkIncludeMode;
};
type AudioOptions = DeviceCommandBaseOptions & {
  action?: 'probe';
  probeAction?: 'start' | 'status' | 'stop';
  durationMs?: number;
  bucketMs?: number;
};
type RecordOptions = AgentDeviceRequestOverrides & {
  action: 'start' | 'stop';
  path?: string;
  fps?: number;
  quality?: RecordingExportQuality;
  hideTouches?: boolean;
  recordingScope?: RecordingScope;
};
type TraceOptions = AgentDeviceRequestOverrides & {
  action: 'start' | 'stop';
  path?: string;
};
//#endregion
//#region packages/contracts/src/client-replay.d.ts
type ReplayRunOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  path: string;
  runtime?: SessionRuntimeHints;
  /**
   * @deprecated ADR 0012 migration step 6: `--update` no longer rewrites
   * the script. Accepted for backward compatibility; every divergence
   * already carries ranked selector suggestions regardless of this flag.
   */
  update?: boolean;
  /** @deprecated Use backend: 'maestro'. */
  maestro?: boolean;
  backend?: string;
  env?: string[];
  timeoutMs?: number;
  /**
   * ADR 0012 decision 4 / migration step 5: resume at this 1-based plan
   * step, skipping `1..resumeFrom-1` without executing them. Requires
   * `resumePlanDigest` from the divergence report that reported this
   * step as the failure. `replay` only — `test` has no resume fields.
   */
  resumeFrom?: number;
  /** The `resume.planDigest` from the divergence report `resumeFrom` came from. */
  resumePlanDigest?: string;
  /** Leave the session active by suppressing an authored terminal `close` in native `.ad`. */
  keepSession?: boolean;
  /**
   * ADR 0012 decision 6, R1/R6: arms agent-supervised re-record repair
   * from this replay attempt onward. Optional string value is the healed
   * `.ad`'s output path; absent one, it defaults to the `<path>` sibling
   * `<stem>.healed.ad` when the repair ends with `close --save-script`.
   */
  saveScript?: boolean | string;
  /** #1258: overwrite an existing --save-script target instead of refusing. Alias: --overwrite. */
  force?: boolean;
};
type ReplayTestOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
  paths: string[];
  runtime?: SessionRuntimeHints;
  update?: boolean;
  /** @deprecated Use backend: 'maestro'. */
  maestro?: boolean;
  backend?: string;
  env?: string[];
  failFast?: boolean;
  timeoutMs?: number;
  retries?: number;
  recordVideo?: boolean;
  artifactsDir?: string;
  /** @deprecated Use the CLI --reporter junit:<path> or --report-junit <path>. */
  reportJunit?: string;
  shardAll?: number;
  shardSplit?: number;
};
type BatchStep = {
  command: string;
  input: Record<string, unknown>;
  runtime?: SessionRuntimeHints;
};
type BatchRunOptions = AgentDeviceRequestOverrides & {
  steps: BatchStep[];
  onError?: 'stop';
  maxSteps?: number;
  out?: string;
};
//#endregion
//#region packages/contracts/src/client-request.d.ts
type CommandRequestResult = DaemonResponseData;
//#endregion
//#region packages/contracts/src/is-predicate.d.ts
/** The complete predicate vocabulary accepted by the `is` command. */
declare const IS_PREDICATES: readonly ['visible', 'hidden', 'exists', 'absent', 'editable', 'selected', 'focused', 'text'];
type IsPredicate = (typeof IS_PREDICATES)[number];
//#endregion
//#region packages/contracts/src/client-selector-read.d.ts
/**
 * #1271 stage 2 (ADR 0012 amendment): `get`/`is`/`find` are observation-only
 * and excluded from a repair-armed heal by default. `record` forces this
 * action through (the corrective-read case); `noRecord` continues to opt the
 * action out entirely. Mutually exclusive.
 */
type RecordControlOptions = {
  noRecord?: boolean;
  record?: boolean;
};
type GetOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & ElementTarget & RecordControlOptions & {
  format: 'text' | 'attrs';
};
type IsTextPredicateOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & RecordControlOptions & {
  predicate: Extract<IsPredicate, 'text'>;
  selector: string;
  value: string;
};
type IsStatePredicateOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & RecordControlOptions & {
  predicate: Exclude<IsPredicate, 'text'>;
  selector: string;
  value?: never;
};
type IsOptions = IsTextPredicateOptions | IsStatePredicateOptions;
type FindBaseOptions = DeviceCommandBaseOptions & FindSnapshotCommandOptions & RecordControlOptions & {
  locator?: FindLocator;
  query: string;
  first?: boolean;
  last?: boolean;
};
type FindOptions = (FindBaseOptions & {
  action?: 'click' | 'focus' | 'exists' | 'getText' | 'getAttrs' | 'list';
}) | (FindBaseOptions & {
  action: 'wait';
  timeoutMs?: number;
}) | (FindBaseOptions & {
  action: 'fill' | 'type';
  value: string;
});
//#endregion
//#region packages/contracts/src/client-session.d.ts
type SessionCloseResult = {
  session: string;
  shutdown?: TargetShutdownResult;
  provider?: CloudProviderSessionResult;
  /**
   * #1258: absolute path of the committed session/healed script when this close
   * published one (`close --save-script`, or a repair-armed session's finalize)
   * — so a client that requested publication learns where the file landed.
   */
  savedScript?: string;
  identifiers: AgentDeviceIdentifiers;
};
type SessionSaveScriptOptions = AgentDeviceRequestOverrides & {
  path?: string;
  /** Atomically replace an existing target instead of refusing publication. */
  force?: boolean;
};
type SessionSaveScriptResult = {
  session: string;
  savedScript: string;
  actionCount: number;
  identifiers: AgentDeviceIdentifiers;
};
//#endregion
//#region packages/contracts/src/client-settings.d.ts
/**
 * Every permission the public client can name: the app-scoped subset plus the macOS-only one, both
 * from the owning declaration. Type-only on purpose — naming a permission must not pull
 * `settings.ts` and its `AppError` dependency onto the client's runtime path.
 */
type PermissionTarget = (typeof MOBILE_PERMISSION_TARGETS)[number] | (typeof MACOS_PERMISSION_TARGETS)[number];
type SettingsUpdateOptions = (DeviceCommandBaseOptions & {
  setting: 'clear-app-state';
  state: 'clear';
  app?: string;
}) | (DeviceCommandBaseOptions & {
  setting: 'reset-keychain';
  state: 'clear';
}) | (DeviceCommandBaseOptions & {
  setting: 'wifi' | 'airplane' | 'location';
  state: 'on' | 'off';
}) | (DeviceCommandBaseOptions & {
  setting: 'location';
  state: 'set';
  latitude: number;
  longitude: number;
}) | (DeviceCommandBaseOptions & {
  setting: 'animations';
  state: 'on' | 'off';
}) | (DeviceCommandBaseOptions & {
  setting: 'appearance';
  state: 'light' | 'dark' | 'toggle';
}) |
/**
 * One member, two legs: with a `state` it applies that rung, and without one it asks the target
 * what it currently holds. The ladder is shared across platforms; an owner that serves neither
 * leg refuses on its own runtime fact rather than answering an empty value.
 */
(DeviceCommandBaseOptions & {
  setting: 'text-size';
  state?: TextSizeCategory;
}) | (DeviceCommandBaseOptions & {
  setting: 'faceid' | 'touchid';
  state: 'match' | 'nonmatch' | 'enroll' | 'unenroll';
}) | (DeviceCommandBaseOptions & {
  setting: 'fingerprint';
  state: 'match' | 'nonmatch';
}) | (DeviceCommandBaseOptions & {
  setting: 'permission';
  state: PermissionAction;
  permission: PermissionTarget;
  mode?: PermissionMode;
});
//#endregion
//#region packages/contracts/src/alert-contract.d.ts
declare const ALERT_ACTIONS: readonly ['get', 'accept', 'dismiss', 'wait'];
type AlertAction = (typeof ALERT_ACTIONS)[number];
//#endregion
//#region packages/contracts/src/client-system.d.ts
type WaitCommandTarget = {
  durationMs: number;
  text?: never;
  ref?: never;
  selector?: never;
  absent?: never;
  stable?: never;
  quietMs?: never;
  timeoutMs?: never;
} | (SelectorSnapshotCommandOptions & {
  text: string;
  durationMs?: never;
  ref?: never;
  selector?: never;
  absent?: never;
  stable?: never;
  quietMs?: never;
  timeoutMs?: number;
}) | (SelectorSnapshotCommandOptions & {
  ref: string;
  durationMs?: never;
  text?: never;
  selector?: never;
  absent?: never;
  stable?: never;
  quietMs?: never;
  timeoutMs?: number;
}) | (SelectorSnapshotCommandOptions & {
  selector: string;
  durationMs?: never;
  text?: never;
  ref?: never;
  absent?: never;
  stable?: never;
  quietMs?: never;
  timeoutMs?: number;
}) | (SelectorSnapshotCommandOptions & {
  absent: string;
  durationMs?: never;
  text?: never;
  ref?: never;
  selector?: never;
  stable?: never;
  quietMs?: never;
  timeoutMs?: number;
}) | (SelectorSnapshotCommandOptions & {
  stable: true;
  durationMs?: never;
  text?: never;
  ref?: never;
  selector?: never;
  absent?: never;
  quietMs?: number;
  timeoutMs?: number;
});
type WaitCommandOptions = DeviceCommandBaseOptions & WaitCommandTarget;
type AlertCommandOptions = DeviceCommandBaseOptions & {
  action?: AlertAction;
  timeoutMs?: number;
};
type AppStateCommandOptions = DeviceCommandBaseOptions;
/** #1638: `back` carries the shared `--settle` triple, and its result may carry the settled diff. */
type BackCommandOptions = DeviceCommandBaseOptions & {
  mode?: BackMode;
} & SettleCommandOptions;
type HomeCommandOptions = DeviceCommandBaseOptions;
type OrientationCommandOptions = DeviceCommandBaseOptions & {
  orientation: DeviceRotation;
};
type FoldCommandOptions = DeviceCommandBaseOptions & SetFoldPoseInput;
type AppSwitcherCommandOptions = DeviceCommandBaseOptions;
type ActionButtonCommandOptions = DeviceCommandBaseOptions;
type TvRemoteCommandOptions = DeviceCommandBaseOptions & {
  button: TvRemoteButton;
  durationMs?: number;
};
type KeyboardCommandOptions = DeviceCommandBaseOptions & {
  action?: 'status' | 'dismiss' | 'enter' | 'return';
};
type ClipboardCommandOptions = (DeviceCommandBaseOptions & {
  action: 'read';
}) | (DeviceCommandBaseOptions & {
  action: 'write';
  text: string;
}) | (DeviceCommandBaseOptions & {
  action: 'paste';
  text: string;
  selectorKey: 'id' | 'label' | 'text' | 'value';
  selectorValue: string;
}) | (DeviceCommandBaseOptions & {
  action: 'copy';
  selectorKey: 'id' | 'label' | 'text' | 'value';
  selectorValue: string;
  expectedText?: string;
});
type ReactNativeCommandOptions = DeviceCommandBaseOptions & {
  action: 'dismiss-overlay';
};
type PrepareCommandOptions = DeviceCommandBaseOptions & {
  action: 'ios-runner';
  timeoutMs?: number;
};
type DoctorCommandOptions = DeviceCommandBaseOptions & {
  targetApp?: string;
  remote?: boolean;
};
type ViewportCommandOptions = DeviceCommandBaseOptions & {
  width: number;
  height: number;
};
//#endregion
//#region packages/contracts/src/app-events.d.ts
type TriggerAppEventCommandResult = {
  event: string;
  eventUrl: string;
  transport: 'deep-link';
  message: string;
};
//#endregion
//#region packages/contracts/src/app-state.d.ts
/**
 * Closed result of the `appstate` command, grounded in the daemon handler's
 * success returns (src/daemon/handlers/session-state.ts `handleAppStateCommand`).
 * A discriminated union on `platform`:
 *  - Apple (`ios` / `macos`) session state, with iOS-only device locators that
 *    the previous hand-written mirror omitted; and
 *  - Android and HarmonyOS foreground `package` / `activity`.
 *
 * The handler returns one of these fixed objects (errors take the `ok: false`
 * path), so each branch is closed.
 */
type AppStateCommandResult = {
  platform: 'ios' | 'macos';
  appName: string;
  appBundleId?: string;
  /** `runner` when the runner read the session app's state; `session` when only the record answered. */
  source: 'session' | 'runner';
  /**
   * How the session app is running, as the runner reads it; absent with `source: 'session'`.
   * `runningBackground` after `home` says the app left the foreground, not what took it.
   */
  state?: AppleApplicationState;
  surface: SessionSurface;
  /** iOS only — the session device's UDID. */
  device_udid?: string;
  /** iOS only — the simulator set path, or `null` when unknown. */
  ios_simulator_device_set?: string | null;
} | {
  platform: 'android' | 'harmonyos';
  package: string;
  activity: string;
};
//#endregion
//#region packages/contracts/src/device.d.ts
/**
 * Closed result of the `boot` command. Mirrors the daemon handler's only
 * success return EXACTLY (src/daemon/handlers/session-state.ts) — the fixed
 * object literal `{ platform, target, device, id, kind, booted }` plus the
 * additive `appleOs` discriminant, emitted only for Apple devices.
 */
type BootCommandResult = {
  platform: PublicPlatform;
  target: DeviceTarget;
  /** Human-readable device name (`device.name`). */
  device: string;
  /** Stable device id (`device.id`). */
  id: string;
  kind: DeviceKind;
  /** Always `true` on the success path. */
  booted: true;
  /**
   * Additive Apple-OS discriminant (`device.appleOs`): iPhone/iPad/tvOS/visionOS/macOS.
   * Present only for Apple devices; absent for non-Apple platforms. `platform` stays the
   * leaf (`ios`/`macos`) — this is an extra field, not a replacement.
   */
  appleOs?: AppleOS;
};
/**
 * Closed result of the `shutdown` command. Mirrors the daemon handler's success
 * return EXACTLY (src/daemon/handlers/session-state.ts) — the fixed object
 * literal `{ platform, target, device, id, kind, shutdown }` plus the additive
 * `appleOs` discriminant (Apple devices only). The `shutdown` field is the raw
 * {@link TargetShutdownResult} returned by the bound `shutdownTarget` operation.
 */
type ShutdownCommandResult = {
  platform: PublicPlatform;
  target: DeviceTarget;
  /** Human-readable device name (`device.name`). */
  device: string;
  /** Stable device id (`device.id`). */
  id: string;
  kind: DeviceKind;
  shutdown: TargetShutdownResult;
  /**
   * Additive Apple-OS discriminant (`device.appleOs`): iPhone/iPad/tvOS/visionOS/macOS.
   * Present only for Apple devices; absent for non-Apple platforms. `platform` stays the
   * leaf (`ios`/`macos`) — this is an extra field, not a replacement.
   */
  appleOs?: AppleOS;
};
//#endregion
//#region packages/contracts/src/replay.d.ts
type ReplayCommandResult = {
  replayed: number;
  healed: number;
  session: string;
  /**
   * True iff `session` still exists in the daemon's session store when the
   * response is built. This remains true when replay suppresses an authored
   * terminal `close` for an explicit live-session handoff. The client uses
   * this, not script parsing, to decide whether an owned one-shot daemon must
   * stay alive so the caller can keep addressing this session.
   */
  sessionActive: boolean;
  artifactPaths: string[];
  warnings?: string[];
  snapshotDiagnostics?: SnapshotDiagnosticsSummary;
  message: string;
};
type ReplaySuiteTestSkipReason = 'skipped-by-filter';
type ReplaySuiteAttemptFailure = {
  attempt: number;
  message: string;
  durationMs?: number;
};
type ReplaySuiteTestPassed = {
  file: string;
  title?: string;
  session: string;
  status: 'passed';
  durationMs: number;
  finalAttemptDurationMs?: number;
  attempts: number;
  artifactsDir?: string;
  replayed: number;
  healed: number;
  warnings?: string[];
  attemptFailures?: ReplaySuiteAttemptFailure[];
  shardIndex?: number;
  shardCount?: number;
  deviceId?: string;
  deviceName?: string;
  snapshotDiagnostics?: SnapshotDiagnosticsSummary;
};
type ReplaySuiteTestFailed = {
  file: string;
  title?: string;
  session: string;
  status: 'failed';
  durationMs: number;
  attempts: number;
  artifactsDir?: string;
  error: DaemonError;
  /** Warnings accumulated before the failing step (skipped `optional` steps, capture degradations). */
  warnings?: string[];
  /** Present when the owning runtime classified the failure as device/runner infrastructure. */
  infrastructure?: true;
  shardIndex?: number;
  shardCount?: number;
  deviceId?: string;
  deviceName?: string;
  snapshotDiagnostics?: SnapshotDiagnosticsSummary;
};
type ReplaySuiteTestSkipped = {
  file: string;
  title?: string;
  status: 'skipped';
  durationMs: 0;
  reason: ReplaySuiteTestSkipReason;
  message: string;
};
type ReplaySuiteTestResult = ReplaySuiteTestPassed | ReplaySuiteTestFailed | ReplaySuiteTestSkipped;
type ReplaySuiteResult = {
  total: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  notRun: number;
  durationMs: number;
  failures: ReplaySuiteTestFailed[];
  tests: ReplaySuiteTestResult[];
  /**
   * The suite's own artifacts root (the parent of every test's `artifactsDir`), as resolved on
   * the host that ran the suite. Absent when the suite produced no attempt (e.g. every source
   * was filtered out). #2246: a remote daemon rewrites this to the caller-local path once the
   * directory has been transferred back, so it always names a path the caller can open.
   */
  artifactsDir?: string;
  snapshotDiagnostics?: SnapshotDiagnosticsSummary;
};
//#endregion
//#region packages/contracts/src/prepare.d.ts
type PrepareIosRunnerCacheKind = 'exact' | 'restore-key' | 'miss' | 'external';
type PrepareIosRunnerArtifactState = 'valid' | 'rebuilt';
type PrepareIosRunnerTiming = {
  totalMs: number;
  additiveParts: {
    buildMs?: number;
    connectAfterBuildMs: number;
    healthCheckMs: number;
  };
  containment: {
    connectMs?: ['buildMs'];
    healthCheckMs: [];
  };
  note: string;
};
/**
 * Public daemon result for `prepare ios-runner`. The runner-local prepare result
 * is projected by `prepareIosRunnerResponseData` with device identity and timing
 * guidance before it reaches the client.
 */
type PrepareCommandResult = {
  action: 'ios-runner';
  platform: PublicPlatform;
  deviceId: string;
  deviceName: string;
  kind: DeviceKind;
  durationMs: number;
  runner: JsonObject;
  cache?: PrepareIosRunnerCacheKind;
  artifact?: PrepareIosRunnerArtifactState;
  buildMs?: number;
  connectMs: number;
  healthCheckMs: number;
  xctestrunPath?: string;
  recoveryReason?: string;
  failureReason?: string;
  timing: PrepareIosRunnerTiming;
  message: string;
};
//#endregion
//#region packages/contracts/src/push.d.ts
type PushCommandResult = {
  platform: 'ios';
  bundleId: string;
  message: string;
} | {
  platform: 'android';
  package: string;
  action: string;
  extrasCount: number;
  message: string;
};
//#endregion
//#region packages/contracts/src/debug-symbols.d.ts
type DebugSymbolsOptions = {
  action?: 'symbols';
  artifact: string;
  dsym?: string;
  searchPath?: string;
  out?: string;
  cwd?: string;
};
type DebugSymbolsImage = {
  name: string;
  uuid: string;
  arch?: string;
  dsymPath: string;
  binaryPath: string;
};
type DebugSymbolsCrashFrame = {
  index: number;
  image: string;
  address: string;
  symbol?: string;
};
type DebugSymbolsCrashSummary = {
  format: 'ips' | 'text';
  appName?: string;
  bundleId?: string;
  version?: string;
  incident?: string;
  timestamp?: string;
  exceptionType?: string;
  exceptionCodes?: string;
  terminationReason?: string;
  crashedThread?: number;
  topFrames: DebugSymbolsCrashFrame[];
  findings: string[];
};
type DebugSymbolsResult = {
  kind: 'debugSymbols';
  platform: 'apple';
  artifactPath: string;
  outPath: string;
  crash: DebugSymbolsCrashSummary;
  matchedImages: DebugSymbolsImage[];
  symbolicatedFrames: number;
  skippedImages: number;
  warnings?: string[];
  message: string;
};
//#endregion
//#region packages/contracts/src/doctor.d.ts
type DoctorStatus = 'pass' | 'warn' | 'fail' | 'info';
type DoctorKind = 'auto' | 'react-native' | 'expo' | 'repack';
type DoctorCheck = {
  id: string;
  status: DoctorStatus;
  summary: string;
  hint?: string;
  command?: string;
  evidence?: Record<string, unknown>;
};
type DoctorCommandResult = {
  status: DoctorStatus;
  summary: string;
  kind: DoctorKind;
  platform?: PlatformSelector;
  target?: DeviceTarget;
  targetApp?: string;
  metro?: {
    host: string;
    port: number;
  };
  checks: DoctorCheck[];
};
//#endregion
//#region packages/contracts/src/diff.d.ts
type SnapshotDiffLine = {
  kind: 'added' | 'removed' | 'unchanged';
  text: string;
  /**
   * Plain ref body (`e12`) of the current-tree node behind an added line.
   * Only populated with `withRefs`; removed and unchanged lines never carry it.
   */
  ref?: string;
};
type SnapshotDiffSummary = {
  additions: number;
  removals: number;
  unchanged: number;
};
type DiffSnapshotCommandResult = {
  mode: 'snapshot';
  baselineInitialized: boolean;
  summary: SnapshotDiffSummary;
  lines: SnapshotDiffLine[];
  warnings?: string[];
};
//#endregion
//#region packages/contracts/src/viewport.d.ts
type ViewportCommandResult = {
  width: number;
  height: number;
  message: string;
};
//#endregion
//#region packages/contracts/src/fold-runtime.d.ts
/** Single source of truth for the discriminator the Apple owner sets and the MCP schema advertises. */
declare const FOLD_SCREEN_COORDINATE_SPACE: 'native-panel';
/**
 * The panel the device lights after the pose settled, in that panel's own native points: its pixel
 * size divided by its point scale, never rotated. `coordinateSpace` is always
 * {@link FOLD_SCREEN_COORDINATE_SPACE}, and these numbers are NOT snapshot coordinates — the active
 * app window can differ from the panel (iPhone Duo: a 669x951 inner panel hosts a 951x669 app
 * window), so they cannot place a tap. A caller that needs the app viewport must take a fresh
 * snapshot.
 */
type FoldScreenReport = Readonly<{
  /** The CoreDevice display name of the panel the device now lights. */
  display: string;
  /** Marks these dimensions as the panel's native points, never a snapshot's app viewport. */
  coordinateSpace: typeof FOLD_SCREEN_COORDINATE_SPACE;
  widthPt: number;
  heightPt: number;
}>;
//#endregion
//#region packages/contracts/src/navigation.d.ts
/**
 * Closed results of the navigation/global action commands. Each mirrors its
 * request-scoped runtime's literal return: a fixed `action` discriminant plus the always-present
 * `successText` message (the handlers always pass a non-empty message, so it is
 * required here). The handlers spread nothing else, so the shapes are closed —
 * consistent with the `viewport` contract, the generic-dispatch Android
 * dialog-recovery `warning` annotation is intentionally not part of the contract.
 */
/** `home` — `{ action: 'home', message: 'Home' }`. */
type HomeCommandResult = {
  action: 'home';
  message: string;
};
/**
 * `back` — `{ action: 'back', mode, message: 'Back' }`; `mode` defaults to
 * `'in-app'`. The one field the generic route may add on top of the dispatch
 * runtime's literal return: `settle`, the opt-in `--settle` observation
 * (#1638), attached after the command by the generic dispatcher.
 */
type BackCommandResult = {
  action: 'back';
  mode: BackMode;
  message: string;
  settle?: SettleObservation;
};
/**
 * `orientation` — `{ action: 'orientation', orientation, message: 'Rotated to <orientation>' }`.
 *
 * An owner that reports no resulting rotation is not evidence that the device
 * rotated. That case keeps the requested `orientation` for compatibility, but
 * discloses `confirmed: false` plus a `warning`, and names the request in
 * `message` (`Rotation requested: <orientation> (unconfirmed)`).
 */
type OrientationCommandResult = {
  action: 'orientation';
  orientation: DeviceRotation;
  message: string;
  confirmed?: boolean;
  warning?: string;
};
/**
 * `fold` — `{ action: 'fold', pose, hingeAngleDegrees, screen?, message }`.
 *
 * Unlike `orientation`, there is no unconfirmed variant: the Apple owner reads the hinge angle
 * back from CoreDevice after the simulator HID helper sends the pose, and reports a pose only when
 * that reading agrees with the request. `screen` names the panel the device lights afterwards and
 * that panel's native point size (ADR 0025); it is the panel's geometry, not the app viewport, so a
 * caller must take a fresh snapshot before placing a tap.
 */
type FoldCommandResult = {
  action: 'fold';
  pose: FoldPose;
  hingeAngleDegrees: number;
  screen?: FoldScreenReport;
  message: string;
};
/** `app-switcher` — `{ action: 'app-switcher', message: 'Opened app switcher' }`. */
type AppSwitcherCommandResult = {
  action: 'app-switcher';
  message: string;
};
/**
 * `action-button` — `{ action: 'action-button', message: 'Pressed Action Button' }`.
 *
 * Deliberately narrower than `tv-remote`: `XCUIDevice.press(.action)` takes no hold duration, so
 * there is no `durationMs` to report and no button to name.
 */
type ActionButtonCommandResult = {
  action: 'action-button';
  message: string;
};
/** `tv-remote` — `{ action: 'tv-remote', button, durationMs?, message }`. */
type TvRemoteCommandResult = {
  action: 'tv-remote';
  button: TvRemoteButton;
  durationMs?: number;
  message: string;
};
//#endregion
//#region packages/contracts/src/clipboard.d.ts
/**
 * Closed result of the `clipboard` command. Mirrors the session runtime's
 * literal return exactly (`src/daemon/handlers/session-clipboard.ts`): a
 * discriminated union on `action`. `read` returns the clipboard `text`; `write`
 * reports the written `textLength` plus the `successText` message. The handler
 * spreads nothing else, so each branch is closed.
 */
type ClipboardCommandResult = {
  action: 'read';
  text: string;
} | {
  action: 'write';
  textLength: number;
  message: string;
} | {
  /** Field paste/copy return the transferred text after exact-field verification. */
  action: 'paste' | 'copy';
  text: string;
  textLength: number;
  message: string;
};
//#endregion
//#region packages/contracts/src/keyboard.d.ts
/**
 * Closed result of the `keyboard` command, grounded in the runtime operation
 * results projected by `src/daemon/keyboard-runtime.ts`.
 *
 * `platform` and `action` are always present; the remaining fields appear per
 * branch (Android `status`/`dismiss` carry the keyboard-state fields; `enter`
 * and iOS `dismiss` carry a `message`). It is kept as a flat closed shape rather
 * than a five-way `platform`×`action` union because the per-branch field sets
 * overlap heavily and the underlying Android keyboard-state types live in the
 * platform layer (below the public contract). The `Record` index signature of
 * the previous hand-written mirror is dropped, and the spurious `| null`s are
 * removed (the handler never returns `null` for these).
 */
type KeyboardCommandResult = {
  platform: 'android' | 'ios';
  action: 'status' | 'dismiss' | 'enter';
  visible?: boolean;
  wasVisible?: boolean;
  dismissed?: boolean;
  attempts?: number;
  inputType?: string;
  type?: 'text' | 'number' | 'email' | 'phone' | 'password' | 'datetime' | 'unknown';
  inputMethodPackage?: string;
  focusedPackage?: string;
  focusedResourceId?: string;
  inputOwner?: 'app' | 'ime' | 'unknown';
  message?: string;
  /** iOS `dismiss` only (#1598): which mechanism actually resigned the
   *  keyboard — 'dismissKey' (tapped the keyboard's own Hide/Dismiss/Done
   *  key). Generic background-tap dismissal is deliberately unsupported
   *  (#1606 review): no query can prove a coordinate is side-effect-free,
   *  so the runner only ever taps the keyboard's own control. Absent when
   *  the keyboard was not dismissed. */
  mechanism?: 'dismissKey';
};
//#endregion
//#region packages/contracts/src/wait.d.ts
/**
 * Public daemon result for `wait`. The runtime-local result carries a `kind`
 * discriminant, but `toDaemonWaitData` intentionally projects the normal daemon
 * payload to this compact shape. The direct iOS selector fast path may still
 * include `kind: 'selector'` additively.
 */
type WaitCommandResult = {
  waitedMs: number;
  kind?: 'selector';
  text?: string;
  selector?: string;
  captures?: number;
  nodeCount?: number;
  hint?: string;
  warning?: string;
};
//#endregion
//#region packages/contracts/src/recording-stop-observation.d.ts
/**
 * What a recording backend observed about its recorder when it was asked to stop
 * (ADR 0024 2.2). This is the first of the two facts a stop answers; whether a playable export
 * exists is answered separately by the export itself.
 *
 * The observation describes what was observed, never what identity proved. An identity probe that
 * could not be read is `unconfirmed`, not `lost`, and a proven mismatch is `lost` even though the
 * same probe found nothing.
 *
 * The variants below define the vocabulary; they are not a claim that anything emits each one.
 * Today's producers answer `confirmed` — an exited `simctl` process, an acknowledged runner stop,
 * Android recorders proven gone, a stopped HarmonyOS toggle, a stopped browser provider — and `lost`
 * with `owner-session-lost` for an Apple recording whose session was invalidated. The unconfirmed
 * reasons and the two identity reasons for `lost` arrive with the steps that gain the probe or the
 * retry they describe; until a step owns one, a stop that cannot prove its recorder gone reports
 * that as its own error rather than serving an export labelled `unconfirmed`.
 */
declare const RECORDER_OBSERVATION_VALUES: readonly ['confirmed', 'unconfirmed', 'lost'];
/** The one word every backend reports, and the word the `record stop` response serves. */
type RecorderObservation = (typeof RECORDER_OBSERVATION_VALUES)[number];
//#endregion
//#region packages/contracts/src/recording-native-path.d.ts
/**
 * What may happen to the recorder's native artifact path — the file the recorder itself writes
 * (the `simctl` output, the device-side chunks, the media-library item, the browser's WebM) once a
 * recording's export is committed (ADR 0024 2.3). This is the second of the two facts a stop
 * answers, and it stays independent of the recorder observation: a recorder that never confirmed
 * leaves its path `pending` even when the export is playable, and a `lost` identity says nothing
 * about who writes there now, so it never permits a deletion either.
 *
 * - `pending`: the backend has not proven the writer gone, so nothing may remove the path.
 * - `retirable`: the writer is proven gone; a fenced retirement is still owed.
 * - `retired`: retirement succeeded or the backend verified the artifact is absent.
 *
 * The bullets define the vocabulary; they are not a claim that anything emits each state. Today's
 * producers answer `retirable` for an Apple runner artifact left on the device and `retired` for an
 * Android recording whose chunks the device no longer shows or a HarmonyOS recording whose removals
 * were verified. A backend whose recorder writes the served export itself omits the field. `pending`
 * is declared ahead of the step that reports a recorder nobody proved gone, and no stop emits it yet.
 */
declare const NATIVE_PATH_DISPOSITION_VALUES: readonly ['pending', 'retirable', 'retired'];
type NativePathDisposition = (typeof NATIVE_PATH_DISPOSITION_VALUES)[number];
//#endregion
//#region packages/contracts/src/recording.d.ts
type RecordingAppIdentity = {
  bundleId: string;
  name?: string;
};
type RecordingStartCommandResult = {
  recording: 'started';
  outPath: string;
  sessionStateDir: string;
  recordingBackend?: string;
  recordingScope?: RecordingScope;
  recordOnlySession?: boolean;
  activeSessionApp?: RecordingAppIdentity;
  showTouches: boolean;
};
type RecordingStopCommandResult = {
  recording: 'stopped';
  outPath: string;
  telemetryPath?: string;
  artifacts: DaemonArtifact[];
  recordingBackend?: string;
  recordingScope?: RecordingScope;
  recordOnlySession?: boolean;
  activeSessionApp?: RecordingAppIdentity;
  durationMs: number;
  capturedDurationMs?: number;
  /**
   * What the recorder itself was observed doing when the stop was carried out (ADR 0024 2.2).
   * `confirmed` is the ordinary answer; `unconfirmed` and `lost` say the export was served without
   * proof that the recorder terminated, which is a disclosure and not a failure. Absent on a
   * response replayed from a manifest written before this field existed.
   */
  recorder?: RecorderObservation;
  /**
   * What the recorder's native artifact path was left as (ADR 0024 2.3): `retired` once the backend
   * removed it and verified that, `retirable` when the writer is proven gone and a fenced removal is
   * still owed, `pending` when nothing proves the writer gone yet. Absent when the backend has no
   * native path of its own to keep.
   */
  nativePathDisposition?: NativePathDisposition;
  showTouches: boolean;
  warning?: string;
  overlayWarning?: string;
  chunks?: Array<{
    index: number;
    path: string;
  }>;
};
type RecordingCommandResult = RecordingStartCommandResult | RecordingStopCommandResult;
type TraceCommandResult = {
  trace: 'started';
  outPath: string;
} | {
  trace: 'stopped';
  outPath: string;
  artifacts: DaemonArtifact[];
};
//#endregion
//#region packages/command-registry/src/command-result.d.ts
/**
 * The additive typed-result spine (ADR-0008, Phase 1 step 6).
 *
 * Maps a command name to the per-command result type from `@agent-device/contracts`. It
 * is SEEDED, not exhaustive: a command is listed here only once its accurate,
 * closed result shape lives in the contracts layer. Commands whose daemon
 * handler spreads dynamic/Record data (screenshot overlays, gesture
 * visualization, perf, logs, …) are deliberately omitted rather than given an
 * invented shape.
 *
 * Batches 1-2 wired `boot` / `shutdown` / `viewport` and the navigation/action
 * commands `home` / `back` / `orientation` / `app-switcher` alongside the seed
 * interaction quartet. Batch 3 adds `clipboard` (a closed clipboard action union) and
 * `appstate` (a closed `platform` union — Apple session state with the iOS-only
 * device locators, or Android package/activity). Batch 4 adds `keyboard` (a
 * closed flat shape). Batch 5 adds the compact daemon projections for `wait`,
 * `prepare`, `push`, and `trigger-app-event`. #1652 adds `scroll`
 * (ScrollCommandResult): the shared dispatch vocabulary plus the opt-in
 * settle observation, so the settle-capable generic-route pair (`back`,
 * `scroll`) is fully typed and its MCP output schema derives from the trait.
 * Each entry is grounded in a
 * re-read of the handler's literal return; see the per-type docstrings.
 */
interface CommandResultMap {
  'action-button': ActionButtonCommandResult;
  'app-switcher': AppSwitcherCommandResult;
  appstate: AppStateCommandResult;
  back: BackCommandResult;
  boot: BootCommandResult;
  click: ClickCommandResponseData;
  clipboard: ClipboardCommandResult;
  diff: DiffSnapshotCommandResult;
  doctor: DoctorCommandResult;
  fill: FillCommandResponseData;
  find: FindCommandResponseData;
  fold: FoldCommandResult;
  home: HomeCommandResult;
  hover: HoverCommandResponseData;
  keyboard: KeyboardCommandResult;
  longpress: LongPressCommandResponseData;
  orientation: OrientationCommandResult;
  prepare: PrepareCommandResult;
  press: PressCommandResponseData;
  push: PushCommandResult;
  record: RecordingCommandResult;
  replay: ReplayCommandResult;
  scroll: ScrollCommandResult;
  shutdown: ShutdownCommandResult;
  test: ReplaySuiteResult;
  trace: TraceCommandResult;
  'trigger-app-event': TriggerAppEventCommandResult;
  'tv-remote': TvRemoteCommandResult;
  viewport: ViewportCommandResult;
  wait: WaitCommandResult;
}
/**
 * The typed result for a command named `N`. Seeded commands resolve to their
 * contract result type from {@link CommandResultMap}; every other (unmigrated)
 * command falls back to the untyped `Record<string, unknown>` bag. That default
 * branch is what keeps the mapping total over every command name, so consumers
 * can switch to `CommandResult<Name>` without first migrating every command.
 */
type CommandResult<N extends string> = N extends keyof CommandResultMap ? CommandResultMap[N] : Record<string, unknown>;
//#endregion
//#region src/client/client-types.d.ts
type AgentDeviceCommandClient = {
  back: (options?: BackCommandOptions) => Promise<CommandResult<'back'>>;
  home: (options?: HomeCommandOptions) => Promise<CommandResult<'home'>>;
  orientation: (options: OrientationCommandOptions) => Promise<CommandResult<'orientation'>>;
  fold: (options: FoldCommandOptions) => Promise<CommandResult<'fold'>>;
  appSwitcher: (options?: AppSwitcherCommandOptions) => Promise<CommandResult<'app-switcher'>>;
  actionButton: (options?: ActionButtonCommandOptions) => Promise<CommandResult<'action-button'>>;
  tvRemote: (options: TvRemoteCommandOptions) => Promise<CommandResult<'tv-remote'>>;
  wait: (options: WaitCommandOptions) => Promise<CommandResult<'wait'>>;
  alert: (options?: AlertCommandOptions) => Promise<CommandRequestResult>;
  appState: (options?: AppStateCommandOptions) => Promise<CommandResult<'appstate'>>;
  keyboard: (options?: KeyboardCommandOptions) => Promise<CommandResult<'keyboard'>>;
  clipboard: (options: ClipboardCommandOptions) => Promise<CommandResult<'clipboard'>>;
  reactNative: (options: ReactNativeCommandOptions) => Promise<CommandRequestResult>;
  doctor: (options?: DoctorCommandOptions) => Promise<CommandResult<'doctor'>>;
  /**
   * JSON prepare results include timing.additiveParts for additive wall-clock phases.
   * Top-level buildMs/connectMs/healthCheckMs are diagnostics and may overlap.
   */
  prepare: (options: PrepareCommandOptions) => Promise<CommandResult<'prepare'>>;
  viewport: (options: ViewportCommandOptions) => Promise<CommandResult<'viewport'>>;
};
type AgentDeviceClient = {
  command: AgentDeviceCommandClient;
  devices: {
    list: (options?: AgentDeviceRequestOverrides & AgentDeviceSelectionOptions) => Promise<AgentDeviceDevice[]>;
    capabilities: (options?: AgentDeviceRequestOverrides & AgentDeviceSelectionOptions) => Promise<AgentDeviceCapabilitiesResult>;
    boot: (options?: DeviceBootOptions) => Promise<CommandResult<'boot'>>;
    shutdown: (options?: DeviceShutdownOptions) => Promise<CommandResult<'shutdown'>>;
  };
  sessions: {
    list: (options?: AgentDeviceRequestOverrides) => Promise<AgentDeviceSession[]>;
    stateDir: (options?: AgentDeviceRequestOverrides & Pick<AgentDeviceClientConfig, 'stateDir'>) => Promise<string>;
    close: (options?: AgentDeviceRequestOverrides & {
      shutdown?: boolean;
      saveScript?: boolean | string;
      /** #1258: overwrite an existing --save-script target instead of refusing. Alias: --overwrite. */
      force?: boolean;
    }) => Promise<SessionCloseResult>;
    saveScript: (options?: SessionSaveScriptOptions) => Promise<SessionSaveScriptResult>;
    artifacts: (options?: CloudArtifactsOptions) => Promise<AgentArtifactsResult>;
  };
  apps: {
    install: (options: AppInstallOptions) => Promise<AppDeployResult>;
    reinstall: (options: AppDeployOptions) => Promise<AppDeployResult>;
    installFromSource: (options: AppInstallFromSourceOptions) => Promise<AppInstallFromSourceResult>;
    list: (options?: AppListOptions) => Promise<string[]>;
    open: (options: AppOpenOptions) => Promise<AppOpenResult>;
    close: (options?: AppCloseOptions) => Promise<AppCloseResult>;
    push: (options: AppPushOptions) => Promise<CommandResult<'push'>>;
    triggerEvent: (options: AppTriggerEventOptions) => Promise<CommandResult<'trigger-app-event'>>;
  };
  materializations: {
    release: (options: MaterializationReleaseOptions) => Promise<MaterializationReleaseResult>;
  };
  leases: {
    allocate: (options: LeaseAllocateOptions) => Promise<Lease>;
    heartbeat: (options: LeaseScopedOptions) => Promise<Lease>;
    release: (options: LeaseScopedOptions) => Promise<{
      released: boolean;
      provider?: CloudProviderSessionResult;
    }>;
    humanControl: {
      list: (options?: AgentDeviceRequestOverrides) => Promise<HumanControlHold[]>;
      put: (id: string, input?: HumanControlHoldOptions, options?: AgentDeviceRequestOverrides) => Promise<HumanControlHold>;
      remove: (id: string, options?: AgentDeviceRequestOverrides) => Promise<boolean>;
    };
  };
  metro: {
    prepare: (options: MetroPrepareOptions) => Promise<MetroPrepareResult>;
    reload: (options?: MetroReloadOptions) => Promise<MetroReloadResult>;
  };
  capture: {
    snapshot: (options?: CaptureSnapshotOptions) => Promise<CaptureSnapshotResult>;
    screenshot: (options?: CaptureScreenshotOptions) => Promise<CaptureScreenshotResult>;
    diff: (options: CaptureDiffOptions) => Promise<CommandResult<'diff'>>;
  };
  interactions: {
    click: (options: ClickOptions) => Promise<CommandResult<'click'>>;
    press: (options: PressOptions) => Promise<CommandResult<'press'>>;
    longPress: (options: LongPressOptions) => Promise<CommandResult<'longpress'>>;
    hover: (options: HoverOptions) => Promise<CommandResult<'hover'>>;
    swipe: (options: SwipeOptions) => Promise<CommandRequestResult>;
    pan: (options: PanOptions) => Promise<CommandRequestResult>;
    drag: (options: DragOptions) => Promise<CommandRequestResult>;
    fling: (options: FlingOptions) => Promise<CommandRequestResult>;
    swipeGesture: (options: SwipeGestureOptions) => Promise<CommandRequestResult>;
    focus: (options: FocusOptions) => Promise<CommandRequestResult>;
    type: (options: TypeTextOptions) => Promise<CommandRequestResult>;
    fill: (options: FillOptions) => Promise<CommandResult<'fill'>>;
    scroll: (options: ScrollOptions) => Promise<CommandRequestResult>;
    pinch: (options: PinchOptions) => Promise<CommandRequestResult>;
    rotateGesture: (options: RotateGestureOptions) => Promise<CommandRequestResult>;
    transformGesture: (options: TransformGestureOptions) => Promise<CommandRequestResult>;
    get: (options: GetOptions) => Promise<CommandRequestResult>;
    is: (options: IsOptions) => Promise<CommandRequestResult>;
    find: (options: FindOptions) => Promise<CommandResult<'find'>>;
  };
  replay: {
    run: (options: ReplayRunOptions) => Promise<CommandResult<'replay'>>;
    test: (options: ReplayTestOptions) => Promise<CommandResult<'test'>>;
  };
  batch: {
    run: (options: BatchRunOptions) => Promise<BatchRunResult>;
  };
  observability: {
    perf: (options: PerfOptions) => Promise<CommandRequestResult>;
    logs: (options?: LogsOptions) => Promise<CommandRequestResult>;
    events: (options?: EventsOptions) => Promise<CommandRequestResult>;
    network: (options?: NetworkOptions) => Promise<CommandRequestResult>;
    audio: (options?: AudioOptions) => Promise<CommandRequestResult>;
  };
  debug: {
    symbols: (options: DebugSymbolsOptions) => Promise<DebugSymbolsResult>;
  };
  recording: {
    record: (options: RecordOptions) => Promise<CommandResult<'record'>>;
    trace: (options: TraceOptions) => Promise<CommandResult<'trace'>>;
  };
  settings: {
    update: (options: SettingsUpdateOptions) => Promise<CommandRequestResult>;
  };
};
//#endregion
export { NetworkOptions as $, DeviceSelectionMetadata as $t, WaitCommandOptions as A, InteractionTarget as At, GetOptions as B, SelectorSnapshotCommandOptions as Bt, HomeCommandOptions as C, ScrollOptions as Ct, ReactNativeCommandOptions as D, TransformGestureOptions as Dt, PrepareCommandOptions as E, SwipeOptions as Et, SessionCloseResult as F, CaptureScreenshotOptions as Ft, CommandRequestResult as G, AppInstallFromSourceOptions as Gt, IsStatePredicateOptions as H, AppCloseResult as Ht, SessionSaveScriptOptions as I, CaptureScreenshotResult as It, ReplayRunOptions as J, AppListOptions as Jt, BatchRunOptions as K, AppInstallFromSourceResult as Kt, SessionSaveScriptResult as L, CaptureSnapshotOptions as Lt, AlertAction as M, RefTarget as Mt, PermissionTarget as N, SelectorTarget as Nt, TvRemoteCommandOptions as O, TypeTextOptions as Ot, SettingsUpdateOptions as P, CaptureDiffOptions as Pt, LogsOptions as Q, AppTriggerEventOptions as Qt, FindBaseOptions as R, CaptureSnapshotResult as Rt, FoldCommandOptions as S, isRecord as Sn, RotateGestureOptions as St, OrientationCommandOptions as T, SwipeGestureOptions as Tt, IsTextPredicateOptions as U, AppDeployOptions as Ut, IsOptions as V, AppCloseOptions as Vt, RecordControlOptions as W, AppDeployResult as Wt, AudioOptions as X, AppOpenResult as Xt, ReplayTestOptions as Y, AppOpenOptions as Yt, EventsOptions as Z, AppPushOptions as Zt, AppStateCommandOptions as _, DeviceCommandBaseOptions as _n, LongPressOptions as _t, WaitCommandResult as a, AgentDeviceDevice as an, HumanControlHoldOptions as at, ClipboardCommandOptions as b, JsonPrimitive as bn, PressOptions as bt, DebugSymbolsOptions as c, DeviceBootOptions as cn, LeaseAllocateOptions as ct, PrepareCommandResult as d, AgentDeviceClientConfig as dn, ClickOptions as dt, DeviceSelectionReason as en, PerfOptions as et, ReplayCommandResult as f, AgentDeviceDaemonTransport as fn, DragOptions as ft, AlertCommandOptions as g, AgentDeviceSelectionOptions as gn, HoverOptions as gt, ActionButtonCommandOptions as h, AgentDeviceRequestOverrides as hn, FocusOptions as ht, TraceCommandResult as i, AgentDeviceCapabilitiesResult as in, HumanControlHold as it, WaitCommandTarget as j, PointTarget as jt, ViewportCommandOptions as k, ElementTarget as kt, DebugSymbolsResult as l, DeviceShutdownOptions as ln, LeaseOptions as lt, TriggerAppEventCommandResult as m, AgentDeviceIdentifiers as mn, FlingOptions as mt, AgentDeviceCommandClient as n, MaterializationReleaseOptions as nn, TraceOptions as nt, DiffSnapshotCommandResult as o, AgentDeviceSession as on, HumanControlHoldScope as ot, ReplaySuiteResult as p, AgentDeviceDaemonTransportContext as pn, FillOptions as pt, BatchStep as q, AppInstallOptions as qt, RecordingCommandResult as r, MaterializationReleaseResult as rn, CloudArtifactsOptions as rt, DoctorCommandResult as s, AgentDeviceSessionDevice as sn, Lease as st, AgentDeviceClient as t, DeviceSelectionSource as tn, RecordOptions as tt, PushCommandResult as u, StartupPerfSample as un, LeaseScopedOptions as ut, AppSwitcherCommandOptions as v, TargetShutdownResult as vn, PanOptions as vt, KeyboardCommandOptions as w, SettleCommandOptions as wt, DoctorCommandOptions as x, JsonValue as xn, RepeatedPressOptions as xt, BackCommandOptions as y, JsonObject as yn, PinchOptions as yt, FindOptions as z, FindSnapshotCommandOptions as zt };