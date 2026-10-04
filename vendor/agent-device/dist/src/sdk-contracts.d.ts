//#region packages/kernel/src/errors.d.ts
/**
 * The known error codes as a value, so gates can enumerate them: every code
 * here must resolve a hint through `defaultHintForCode`, and every code
 * `retriableForErrorCode` classifies must have a recovery quiz in the help
 * benchmark (scripts/__tests__/help-conformance-error-recovery-coverage.test.ts).
 * `KnownAppErrorCode` is derived from this array, so a new code cannot be added
 * to the type without entering the enumeration.
 */
declare const KNOWN_APP_ERROR_CODES: readonly ['INVALID_ARGS', 'DEVICE_NOT_FOUND', 'DEVICE_IN_USE', 'TOOL_MISSING', 'APP_NOT_INSTALLED', 'UNSUPPORTED_PLATFORM', 'UNSUPPORTED_OPERATION', 'NOT_IMPLEMENTED', 'COMMAND_FAILED', 'SESSION_NOT_FOUND', 'UNAUTHORIZED', 'AMBIGUOUS_MATCH', 'REPLAY_DIVERGENCE', 'REPAIR_SESSION_EXPIRED', 'REPAIR_COMMIT_FAILED', 'UNKNOWN'];
type KnownAppErrorCode = (typeof KNOWN_APP_ERROR_CODES)[number];
type AppErrorCode = KnownAppErrorCode | (string & {});
/**
 * Locator for one request's diagnostics record on the daemon host, in the
 * daemon's own vocabulary rather than as a filesystem path: `logPath` names
 * that same record as a path, which only a caller on the daemon host can read.
 * A remote caller fetches the record by this locator instead
 * (`GET /sessions/<session>/requests/<requestId>/diagnostics`).
 */
type DiagnosticsRecordRef = {
  session: string;
  requestId: string;
};
type ErrorCause = {
  message: string;
  code?: string;
};
/**
 * Details bag for AppError. Free-form context is allowed, but these keys carry
 * meaning at normalize/render time and must keep their types:
 * - `hint` — overrides `defaultHintForCode`; re-wraps preserve an existing hint.
 * - `diagnosticId` / `logPath` / `logPathUnavailable` / `diagnosticsRecord` —
 *   lifted onto the normalized error, stripped from details.
 * - `processExitError` + `stdout`/`stderr`/`exitCode` — marks a wrap of a real
 *   process exit so normalizeError can surface the first meaningful stderr line;
 *   build these via `execFailureDetails`/`requireExecSuccess` in @agent-device/host-kit/command
 *   rather than by hand.
 * - `retriable` — typed retry signal hoisted to the wire error shape.
 * - `reason` — machine-dispatchable sub-classification within a code.
 */
type AppErrorDetails = Record<string, unknown> & {
  hint?: string;
  diagnosticId?: string;
  logPath?: string;
  logPathUnavailable?: string;
  diagnosticsRecord?: DiagnosticsRecordRef;
  retriable?: boolean;
  supportedOn?: string;
  processExitError?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  reason?: string;
};
type NormalizedError = {
  code: string;
  message: string;
  cause?: ErrorCause;
  hint?: string;
  diagnosticId?: string;
  /**
   * Diagnostics record path **the reader of this error can open**. A daemon
   * renders its own host path here; a client talking to a REMOTE daemon
   * replaces it with the caller-local copy it fetched, or drops it and sets
   * `logPathUnavailable` (see `localizeRemoteDaemonError`). A path the reader
   * cannot open never belongs in this field (#1801).
   */
  logPath?: string;
  /**
   * Why no readable `logPath` could be produced, e.g.
   * `remote daemon https://host, request 8f2c: 404`. Set only in place of
   * `logPath`, and never carries a daemon-host path.
   */
  logPathUnavailable?: string;
  /** Locator the record can be fetched by when it lives on a remote daemon. */
  diagnosticsRecord?: DiagnosticsRecordRef;
  /**
   * Lifted from `details.retriable` when a throw site classified the failure as
   * clearly transient (or clearly not). Included only when set, so the default
   * error wire shape is unchanged.
   */
  retriable?: boolean;
  supportedOn?: string;
  details?: Record<string, unknown>;
};
/**
 * Error payload returned by the daemon transport. It is kept beside the local
 * error representation because clients immediately rehydrate this wire shape
 * into `AppError` before rendering or handling it.
 */
type DaemonError = {
  code: string;
  message: string;
  cause?: ErrorCause;
  hint?: string;
  diagnosticId?: string;
  /** Path on the DAEMON host. Meaningful to a local caller only (#1801). */
  logPath?: string;
  /** Why no readable path is named; set by the client, never by the daemon. */
  logPathUnavailable?: string;
  /**
   * Additive locator (#1801) for the request diagnostics record `logPath`
   * names, so a remote caller can fetch it over the daemon API instead of
   * being handed a path on a filesystem it cannot read.
   */
  diagnosticsRecord?: DiagnosticsRecordRef;
  details?: Record<string, unknown>;
  /** Additive retry and platform-support signals; absent when not derivable. */
  retriable?: boolean;
  supportedOn?: string;
};
declare class AppError extends Error {
  code: AppErrorCode;
  details?: AppErrorDetails;
  cause?: unknown;
  constructor(code: AppErrorCode, message: string, details?: AppErrorDetails, cause?: unknown);
}
declare function isAgentDeviceError(err: unknown): err is AppError;
type NormalizeErrorContext = {
  diagnosticId?: string;
  logPath?: string;
  diagnosticsRecord?: DiagnosticsRecordRef;
};
declare function normalizeAgentDeviceError(err: unknown, context?: NormalizeErrorContext): NormalizedError;
declare function normalizeError(err: unknown, context?: NormalizeErrorContext): NormalizedError;
declare function defaultHintForCode(code: string): string | undefined;
//#endregion
//#region packages/kernel/src/snapshot.d.ts
/**
 * Structured quality verdict computed once by a platform snapshot capture/presentation plan.
 * The daemon renders it; it never re-derives degradation from node shapes.
 *
 * Defined here (the foundational snapshot type module) rather than in
 * capture-kit's snapshot-quality-verdict.ts so SnapshotNode can reference it without a cyclic
 * import. Ownership splits three ways: this module owns the vocabularies below, capture-kit parses
 * an untrusted runner payload into them, and contracts re-hydrates a verdict this repo published.
 */
/**
 * Which capture STRATEGY produced a snapshot, within one platform's plan —
 * distinct from `SnapshotBackend`, which names the platform channel
 * (`xctest`/`android`/…). A platform plan may change strategy mid-sequence, and two strategies do
 * not return comparable views of one screen (#1569). Android's helper presentation is included
 * here so its quality verdict uses the same typed contract as the iOS strategy chain.
 */
type SnapshotCaptureBackend = 'tree' | 'queries' | 'private-ax' | 'android-helper';
/** Internal backends that evidence probes may select explicitly. */
type SnapshotPreferredBackend = 'tree' | 'private-ax';
type SnapshotQualityTiming = {
  acquisitionMs: number;
  presentationMs: number;
};
/**
 * The verdict states a capture plan may stamp. This tuple is the ONE declaration of that
 * vocabulary, and `SnapshotQualityVerdict['state']` is its projection; readers hold exhaustive maps
 * over the union instead of importing this module, because the eager-closure gate freezes their
 * loading shape (#2872). This tuple and the Apple runner's `SnapshotQualityState.allCases` are each
 * pinned as a set to `contracts/fixtures/ios-snapshot-quality-states.json`, so a state one side
 * renames, adds, or deletes without the other goes red there instead of arriving as a verdict the
 * host cannot name — which reads as verdict-absent and drops the disclosure with it.
 */
declare const SNAPSHOT_QUALITY_STATES: readonly ['healthy', 'recovered', 'sparse'];
type SnapshotQualityState = (typeof SNAPSHOT_QUALITY_STATES)[number];
type SnapshotQualityVerdict = {
  state: SnapshotQualityState;
  backend: SnapshotCaptureBackend;
  reason?: string;
  reasonCode?: 'ax-rejected' | 'sparse-tree' | 'budget' | 'no-nodes' | 'capture-failed' | 'presentation-failed' | 'deferred' | 'requested-backend';
  effectiveDepth?: number;
  collapsedLeafIndexes?: number[];
  /**
   * Coverage of an opt-in custom-action pass (`snapshot --actions`): how many
   * merged elements were eligible and how many the bounded pass reached. An
   * unread element is indistinguishable from one with no actions, so a partial
   * pass has to be disclosed rather than left to look complete.
   */
  customActions?: {
    read: number;
    candidates: number;
    truncated: number;
    blocked: boolean;
  };
  /** Response-level phase timing for the backend named by `backend`. */
  timing?: SnapshotQualityTiming;
};
type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type Point = {
  x: number;
  y: number;
};
type SnapshotOptions = {
  interactiveOnly?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
  /**
   * Internal (never CLI-exposed): capture with this backend first regardless of
   * channel health. Evidence comparisons are only valid same-backend (backends
   * are not comparable views of a screen), so a corroboration probe must be
   * captured the way its baseline was.
   */
  preferredBackend?: SnapshotPreferredBackend;
  /**
   * Read accessibility custom actions for elements that merge their children
   * away. Opt-in because each such element costs its own accessibility round
   * trip; see `RawSnapshotNode.actions`.
   */
  customActions?: boolean;
};
/** The CLI/daemon flag key for each snapshot capture option, by option name. */
declare const SNAPSHOT_OPTION_FLAGS: {
  readonly interactiveOnly: 'snapshotInteractiveOnly';
  readonly depth: 'snapshotDepth';
  readonly scope: 'snapshotScope';
  readonly raw: 'snapshotRaw';
  readonly customActions: 'snapshotCustomActions';
  readonly forceFull: 'snapshotForceFull';
  readonly includeHiddenContentHints: 'snapshotIncludeHiddenContentHints';
  readonly preferredBackend: 'snapshotPreferredBackend';
};
type SnapshotOptionKey = keyof typeof SNAPSHOT_OPTION_FLAGS;
type SnapshotOptionValues = {
  interactiveOnly: boolean;
  depth: number;
  scope: string;
  raw: boolean;
  customActions: boolean;
  forceFull: boolean;
  includeHiddenContentHints: boolean;
  preferredBackend: SnapshotPreferredBackend;
};
/** The option-vocabulary view of the declared pairs, narrowed to `TKeys`. */
type SnapshotOptionFields<TKeys extends SnapshotOptionKey = SnapshotOptionKey> = { [TKey in TKeys]?: SnapshotOptionValues[TKey]; };
/**
 * Option keys a `snapshot`/`diff` command request carries end to end. `scope` is
 * resolved against the session before capture, so seams that resolve it spread
 * this projection and then override that one key.
 */
declare const SNAPSHOT_COMMAND_OPTION_KEYS: readonly ['interactiveOnly', 'depth', 'scope', 'raw', 'customActions', 'forceFull'];
/**
 * The snapshot capture options a `snapshot`/`diff` request is stated in, in
 * every vocabulary that names them: the public SDK type, the internal request
 * bag and the command runtime options each reference THIS type instead of
 * re-listing the same six keys.
 */
type SnapshotCommandOptionFields = SnapshotOptionFields<(typeof SNAPSHOT_COMMAND_OPTION_KEYS)[number]>;
type RawSnapshotNode = {
  index: number;
  type?: string;
  role?: string;
  subrole?: string;
  label?: string;
  value?: string;
  /**
   * Android content description when it is not already the `label`. An Android node is
   * labelled by its text and falls back to the content description only when it has none,
   * so an accessibility label the app set beside visible text (a labelled text view, a
   * filled or hinted field) is carried here for consumers that want the accessible name.
   */
  contentDescription?: string;
  identifier?: string;
  rect?: Rect;
  enabled?: boolean;
  selected?: boolean;
  /** Checked state of a checkable control (switch, checkbox, radio); absent means not checkable or unavailable. */
  checked?: boolean;
  focused?: boolean;
  /** Accessibility heading flag an app set on the node; absent means not a heading or unavailable. */
  heading?: boolean;
  /** Localized role description an app set beside the native class, verbatim (`Tab`, `Tab List`, `Link`). */
  roleDescription?: string;
  /** Native accessibility facts; absent means unavailable, not false. */
  editable?: boolean;
  password?: boolean;
  hintShowing?: boolean;
  /**
   * Placeholder text of a text field (the Android hint), whether or not the field is showing it.
   * Absent when the field has none or the producer did not read it.
   */
  placeholder?: string;
  /** Accessibility selection offsets, never a character count or proof of value equality. */
  selectionStart?: number;
  selectionEnd?: number;
  visibleToUser?: boolean;
  /** UIKit `isUserInteractionEnabled`; absent means the producer did not read it, not false. */
  userInteractionEnabled?: boolean;
  hittable?: boolean;
  depth?: number;
  parentIndex?: number;
  pid?: number;
  bundleId?: string;
  appName?: string;
  windowTitle?: string;
  surface?: string;
  hiddenContentAbove?: boolean;
  hiddenContentBelow?: boolean;
  interactionBlocked?: 'covered';
  presentationHints?: string[];
  /**
   * Backend-minted ref for this node, when the capture backend already assigns a
   * stable, actionable ref (e.g. the web/agent-browser backend resolves actions
   * against its own `@eN` refs). `attachRefs` preserves this instead of re-minting
   * a dense positional ref, so the ref an agent sees in the snapshot is the same
   * ref the backend can resolve on the next action. Absent for backends that do
   * not mint refs — those fall back to dense `e${index}` numbering.
   */
  ref?: string;
  /**
   * Accessibility custom actions the element exposes (iOS
   * `UIAccessibilityCustomAction`, React Native `accessibilityActions`). Merged
   * cards publish their real affordances here instead of as child elements, so
   * this is often the only evidence that a collapsed node has any. Populated by
   * opt-in captures only — see `snapshot --actions`.
   */
  actions?: string[];
};
/**
 * What a capture's producer can say about the software keyboard on screen, measured while the tree
 * was captured rather than rebuilt from it afterwards.
 *
 * A keyboard is its own system surface, so it never reaches the tree as a covering sibling of app
 * content, and a consumer that wants to refuse a tap behind it has to learn where it is from
 * somewhere (#2589). A producer that can measure the band directly — the Apple runner, from its
 * `app.keyboards` query — publishes one fact per capture and says nothing else about it. A consumer therefore gets three
 * answers and no fourth: a band in the same space as every node rect, a proven absence, or a
 * producer that could not look.
 *
 * A producer that publishes nothing has declared nothing, so absence from a result means the same
 * thing as `unmeasurable` — which is why the field stays optional on every carrier, including the
 * three client-side paths that rebuild a state from a bare backend result (#2199). Those consumers
 * then derive the band from the tree they hold: the rule that stays for the producers that publish
 * no fact (#2660).
 */
type SnapshotKeyboardBandFact =
/** The band the keyboard occupies, in the same orientation space as this capture's node rects. */
{
  kind: 'visible';
  frame: Rect;
} |
/** The producer looked for the keyboard and found none. */
{
  kind: 'absent';
} |
/**
 * The producer cannot measure the band on this path, with a stable reason code. Typed rather than
 * inferred from absence so a log says which path failed to measure without the consumer having to
 * guess which producer it was talking to.
 */
{
  kind: 'unmeasurable';
  reason: string;
};
type SnapshotNode = RawSnapshotNode & {
  ref: string;
  /**
   * Output-only marker set by client-serialization dedup (see
   * ../snapshot/snapshot-label-dedup.ts) when `label`/`identifier` was omitted
   * because it string-equals the nearest ancestor's value in the parent chain.
   * Never set on the in-daemon session tree used by selectors/wait/replay.
   */
  inheritsLabel?: true;
  inheritsIdentifier?: true;
};
/**
 * The channel↔producer pairs that can actually occur. One channel is fed by several producers
 * with different guarantees: `xctest` trees come from the local Apple runner, Appium
 * page-source XML, or a limrun element tree, and only the runner's output has been through the
 * runner's presentation (clip fold, effective geometry, scope). Logic that assumes
 * presentation, scope, or geometry guarantees must key on the producer, never on the channel
 * alone.
 *
 * This table is the single owner of both vocabularies: the platform channel
 * (`SnapshotBackend` is its `backend` projection) and the acquisition producer (the third
 * axis beside the channel and the in-plan capture strategy `SnapshotCaptureBackend`). Every
 * carrier embeds the pair atomically — a cross-channel pair does not compile (pinned by
 * snapshot-provenance.test.ts).
 */
type SnapshotProvenance = {
  backend: 'xctest';
  producer: 'apple-runner' | 'simulator-ax-bridge' | 'appium-source' | 'limrun-ios-tree';
} | {
  backend: 'android';
  producer: 'android-uiautomator' | 'appium-source';
} | {
  backend: 'harmonyos-arkui';
  producer: 'harmonyos-uitest';
} | {
  backend: 'macos-helper';
  producer: 'macos-helper';
} | {
  backend: 'linux-atspi';
  producer: 'linux-atspi';
} | {
  backend: 'web';
  producer: 'agent-browser';
};
type OptionalProducerProvenance<Pair> = Pair extends {
  backend: infer Backend;
  producer: infer Producer;
} ? {
  backend: Backend;
  producer?: Producer;
} : never;
/**
 * The provenance carrier for {@link SnapshotState}: the producer may be absent (a client-side
 * fallback that rebuilds a state from a bare backend result knows the channel and nothing more),
 * but a present pair still has to come from the {@link SnapshotProvenance} table — the channel
 * may not carry a foreign producer.
 */
type SnapshotStateProvenance = OptionalProducerProvenance<SnapshotProvenance> | {
  backend?: undefined;
  producer?: undefined;
};
/**
 * Reasons the Apple runner can stamp when serving a command required re-activating the session app
 * (#2682). Mirrors its `activateTarget(bundleId:reason:)` call sites.
 */
declare const IOS_TARGET_ACTIVATION_REASONS: readonly ['bundle_changed', 'stale_target', 'missing_after_wait', 'interaction_foreground_guard'];
type IosTargetActivationReason = (typeof IOS_TARGET_ACTIVATION_REASONS)[number];
/**
 * How XCTest reports an app running (`XCUIApplication.State`), in the SDK's raw order: unknown 0,
 * notRunning 1, suspended 2, plain background 3, foreground 4 — the SDK declares suspended on
 * non-macOS platforms only. This is the one declaration of those names; the `appState` runner
 * command answers the session app's state with them, and `RunnerTests+ApplicationStateRawValueTests`
 * ties them to the SDK enum. The `appState` path names states, so nothing here assigns a raw value;
 * only the activation decoder's raw table does.
 */
declare const APPLE_APPLICATION_STATES: readonly ['unknown', 'notRunning', 'runningBackgroundSuspended', 'runningBackground', 'runningForeground'];
type AppleApplicationState = (typeof APPLE_APPLICATION_STATES)[number];
/**
 * States an activation could have been needed for: every Apple state except the foreground one,
 * which the runner skips `activate()` in and therefore stamps no fact about. Derived from the full
 * list so the two cannot drift, and in the SDK's raw order — a state added to the full list lands
 * here and must then be pinned natively before the decoder tie accepts it.
 */
declare const IOS_TARGET_ACTIVATION_PRIOR_STATES: readonly ("notRunning" | "runningBackground" | "runningBackgroundSuspended" | "unknown")[];
type IosTargetActivationPriorState = (typeof IOS_TARGET_ACTIVATION_PRIOR_STATES)[number];
/**
 * Foreground repair the Apple runner performed while serving one command (#2682). `priorState` is
 * the session app's state BEFORE the runner activated it, so the fact describes what was repaired
 * rather than what the repair produced. `otherActiveApplicationPid` is present only when exactly one
 * application other than the session app held an active accessibility session at that moment: a
 * liveness claim and nothing more, since the private AX client reports no ordering of
 * `activeApplications`, resolves pids only, and answers no bundle id for an arbitrary app.
 */
type IosTargetActivation = Readonly<{
  reason: IosTargetActivationReason;
  priorState: IosTargetActivationPriorState;
  otherActiveApplicationPid?: number;
}>;
type SnapshotState = {
  nodes: SnapshotNode[];
  createdAt: number;
  truncated?: boolean;
  snapshotQuality?: SnapshotQualityVerdict;
  comparisonSafe?: boolean;
  presentationKey?: string;
  /** Opaque equality key for iOS acquisition and presentation lineage. */
  comparisonKey?: string;
  /**
   * Android: the capture is an occluding system surface (notification shade, quick settings)
   * rather than app content. Consumers that surface this tree to the agent must disclose the
   * occlusion (see `@agent-device/contracts/android-system-surface-disclosure`).
   */
  systemSurfaceOnly?: boolean;
  /**
   * iOS: the bundle id of the in-place system surface this capture describes (a web sign-in sheet
   * presented over the app, #2438). Two captures that disagree here describe different surfaces and
   * must never be compared as the same presentation; consumers that surface the tree disclose it.
   */
  iosSystemSurfaceBundleId?: string;
  /**
   * iOS: the keyboard band this capture's producer measured, when it measured one. The tap-path
   * keyboard guard prefers this over the band it would otherwise derive from `nodes`, because a
   * producer that can query the keyboard directly answers in the app's own orientation space and
   * needs no geometry to be plausible (#2660). Absent means the guard measures the tree as before.
   */
  keyboard?: SnapshotKeyboardBandFact;
  /**
   * iOS: this capture's own command found the session app out of foreground and the runner
   * activated it before answering, so an earlier observation in the session described whatever held
   * the foreground instead (#2682). Consumers that surface this tree disclose the repair.
   */
  targetActivation?: IosTargetActivation;
  /** What post-gesture stabilization proved about the gesture before this capture. */
  postGestureOutcome?: PostGestureOutcome;
} & SnapshotStateProvenance;
/** The gesture a post-gesture outcome fact names: the command and its positionals. */
type PostGestureAction = {
  action: string;
  positionals: string[];
};
/**
 * `unsettled`: the surface was still changing when the stabilization deadline expired.
 * `no-effect`: the settled surface still matches the pre-gesture tree (#1600).
 */
type PostGestureOutcome = {
  kind: 'unsettled' | 'no-effect';
  gesture: PostGestureAction;
};
type SnapshotUnchanged = {
  ageMs: number;
  nodeCount: number;
  interactiveOnly?: boolean;
  scope?: string;
};
type SnapshotVisibilityReason = 'offscreen-nodes' | 'scroll-hidden-above' | 'scroll-hidden-below';
type SnapshotVisibility = {
  partial: boolean;
  visibleNodeCount: number;
  totalNodeCount: number;
  reasons: SnapshotVisibilityReason[];
};
type ScreenshotOverlayRef = {
  ref: string;
  label?: string;
  rect: Rect;
  overlayRect: Rect;
  center: Point;
};
declare function centerOfRect(rect: Rect): Point;
//#endregion
//#region packages/kernel/src/device.d.ts
declare const APPLE_OS_VALUES: readonly ['ios', 'ipados', 'tvos', 'watchos', 'visionos', 'macos'];
type AppleOS = (typeof APPLE_OS_VALUES)[number];
declare const PLATFORMS: readonly ['apple', 'android', 'harmonyos', 'vega', 'linux', 'web'];
type Platform = (typeof PLATFORMS)[number];
declare const PUBLIC_PLATFORMS: readonly ['ios', 'macos', 'android', 'harmonyos', 'vega', 'linux', 'web'];
type PublicPlatform = (typeof PUBLIC_PLATFORMS)[number];
declare const PLATFORM_SELECTORS: readonly ["apple", "android", "harmonyos", "vega", "linux", "web", "ios", "macos"];
type PlatformSelector = (typeof PLATFORM_SELECTORS)[number];
declare const DEVICE_KINDS: readonly ['simulator', 'emulator', 'device'];
type DeviceKind = (typeof DEVICE_KINDS)[number];
declare const DEVICE_TARGETS: readonly ['mobile', 'tv', 'desktop'];
type DeviceTarget = (typeof DEVICE_TARGETS)[number];
type DeviceInfo = {
  platform: Platform;
  id: string;
  name: string;
  kind: DeviceKind;
  target?: DeviceTarget;
  appleOs?: AppleOS;
  booted?: boolean;
  simulatorSetPath?: string;
  iosPhysicalDeviceBackend?: 'coredevice' | 'xctest';
};
//#endregion
//#region packages/kernel/src/contracts.d.ts
declare const SESSION_RUNTIME_PLATFORMS: readonly ['ios', 'android', 'harmonyos'];
type SessionRuntimePlatform = (typeof SESSION_RUNTIME_PLATFORMS)[number];
type SessionRuntimeHints = {
  platform?: SessionRuntimePlatform;
  metroHost?: string;
  metroPort?: number;
  bundleUrl?: string;
  launchUrl?: string;
};
type DaemonInstallSource = {
  kind: 'url';
  url: string;
  headers?: Record<string, string>;
} | {
  kind: 'path';
  path: string;
} | ({
  kind: 'github-actions-artifact';
  owner: string;
  repo: string;
} & ({
  artifactId: number;
} | {
  runId: number;
  artifactName: string;
} | {
  artifactName: string;
}));
/** Install sources that can be materialized by a local daemon. */
type LocalInstallSource = Extract<DaemonInstallSource, {
  kind: 'url' | 'path';
}>;
declare const DAEMON_LOCK_POLICIES: readonly ['reject', 'strip'];
type DaemonLockPolicy = (typeof DAEMON_LOCK_POLICIES)[number];
declare const LEASE_BACKENDS: readonly ['ios-simulator', 'ios-instance', 'android-instance', 'harmonyos-instance'];
type LeaseBackend = (typeof LEASE_BACKENDS)[number];
declare const DAEMON_SERVER_MODES: readonly ['socket', 'http', 'dual'];
type DaemonServerMode = (typeof DAEMON_SERVER_MODES)[number];
declare const DAEMON_TRANSPORT_PREFERENCES: readonly ['auto', 'socket', 'http'];
type DaemonTransportPreference = (typeof DAEMON_TRANSPORT_PREFERENCES)[number];
declare const SESSION_ISOLATION_MODES: readonly ['none', 'tenant'];
type SessionIsolationMode = (typeof SESSION_ISOLATION_MODES)[number];
declare const NETWORK_INCLUDE_MODES: readonly ['summary', 'headers', 'body', 'all'];
type NetworkIncludeMode = (typeof NETWORK_INCLUDE_MODES)[number];
declare const RESPONSE_LEVELS: readonly ['digest', 'default', 'full'];
type ResponseLevel = (typeof RESPONSE_LEVELS)[number];
type DaemonRequestMeta = {
  requestId?: string;
  debug?: boolean;
  includeCost?: boolean;
  responseLevel?: ResponseLevel;
  cwd?: string;
  sessionExplicit?: boolean;
  tenantId?: string;
  runId?: string;
  leaseId?: string;
  leaseTtlMs?: number;
  leaseBackend?: LeaseBackend;
  leaseProvider?: string;
  deviceKey?: string;
  clientId?: string;
  sessionIsolation?: SessionIsolationMode;
  uploadedArtifactId?: string;
  clientArtifactPaths?: Record<string, string>;
  installSource?: DaemonInstallSource;
  retainMaterializedPaths?: boolean;
  materializedPathRetentionMs?: number;
  materializationId?: string;
  lockPolicy?: DaemonLockPolicy;
  lockPlatform?: PlatformSelector;
  requestProgress?: 'replay-test' | 'command';
};
type DaemonRequest = {
  token?: string;
  session?: string;
  command: string;
  positionals: string[];
  input?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  runtime?: SessionRuntimeHints;
  meta?: DaemonRequestMeta;
};
type DaemonArtifactKnownType = 'screenshot' | 'screenshot-diff' | 'screen-recording' | 'screen-recording-chunk' | 'screen-recording-contact-sheet' | 'screen-recording-telemetry' | 'trace-log' | 'test-artifacts';
type DaemonArtifactType = DaemonArtifactKnownType | (string & {});
type DaemonArtifact = {
  field: string;
  artifactType?: DaemonArtifactType;
  artifactId?: string;
  fileName?: string;
  localPath?: string;
  path?: string;
};
type ResponseCost = {
  wallClockMs: number;
  runnerRoundTrips: number;
  nodeCount?: number;
};
type DaemonResponseData = Record<string, unknown> & {
  artifacts?: DaemonArtifact[];
  cost?: ResponseCost;
};
type DaemonResponse = {
  ok: true;
  data?: DaemonResponseData;
} | {
  ok: false;
  error: DaemonError;
};
type JsonRpcId = string | number | null;
type JsonRpcRequestEnvelope<TParams = unknown> = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: TParams;
};
//#endregion
export { Rect as A, SnapshotVisibility as B, Platform as C, IosTargetActivation as D, AppleApplicationState as E, SnapshotOptions as F, DaemonError as G, AppError as H, SnapshotProvenance as I, NormalizedError as J, ErrorCause as K, SnapshotQualityVerdict as L, SnapshotCommandOptionFields as M, SnapshotKeyboardBandFact as N, Point as O, SnapshotNode as P, normalizeError as Q, SnapshotState as R, DeviceTarget as S, PublicPlatform as T, AppErrorCode as U, centerOfRect as V, AppErrorDetails as W, isAgentDeviceError as X, defaultHintForCode as Y, normalizeAgentDeviceError as Z, SessionIsolationMode as _, DaemonRequest as a, DeviceInfo as b, DaemonServerMode as c, JsonRpcRequestEnvelope as d, LeaseBackend as f, ResponseLevel as g, ResponseCost as h, DaemonLockPolicy as i, ScreenshotOverlayRef as j, RawSnapshotNode as k, DaemonTransportPreference as l, NetworkIncludeMode as m, DaemonArtifactType as n, DaemonResponse as o, LocalInstallSource as p, KnownAppErrorCode as q, DaemonInstallSource as r, DaemonResponseData as s, DaemonArtifact as t, JsonRpcId as u, SessionRuntimeHints as v, PlatformSelector as w, DeviceKind as x, AppleOS as y, SnapshotUnchanged as z };