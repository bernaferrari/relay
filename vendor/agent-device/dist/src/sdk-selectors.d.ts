import { A as ScreenshotOverlayRef, C as Platform, D as Point, E as IosTargetActivation, F as SnapshotProvenance, I as SnapshotQualityVerdict, L as SnapshotState, M as SnapshotKeyboardBandFact, N as SnapshotNode, O as RawSnapshotNode, P as SnapshotOptions$1, T as PublicPlatform, h as ResponseCost, k as Rect } from "./sdk-contracts.js";
//#region packages/contracts/src/session-surface.d.ts
declare const SESSION_SURFACES: readonly ['app', 'frontmost-app', 'desktop', 'menubar'];
type SessionSurface = (typeof SESSION_SURFACES)[number];
//#endregion
//#region packages/contracts/src/snapshot-diagnostics.d.ts
type SnapshotTimingStats = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  slowThresholdMs: number;
  platform?: PublicPlatform;
  backends?: Record<string, number>;
};
type SnapshotDiagnosticsSummary = {
  stats: SnapshotTimingStats;
  warning?: string;
};
//#endregion
//#region packages/contracts/src/snapshot-types.d.ts
type ScreenshotResultData = {
  path?: string;
  width?: number;
  height?: number;
  logicalWidth?: number;
  logicalHeight?: number;
  pixelDensity?: number;
  overlayRefs?: ScreenshotOverlayRef[];
  warnings?: string[];
};
type BackendSnapshotResult = {
  nodes?: SnapshotNode[];
  truncated?: boolean;
  backend?: string;
  snapshot?: SnapshotState;
  appName?: string;
  appBundleId?: string;
  snapshotDiagnostics?: SnapshotDiagnosticsSummary;
  analysis?: {
    rawNodeCount: number;
    maxDepth: number;
  };
  androidSnapshot?: AndroidSnapshotBackendMetadata;
  freshness?: {
    action: string;
    retryCount: number;
    staleAfterRetries: boolean;
    reason?: 'empty-interactive' | 'sharp-drop' | 'stuck-route';
  };
  quality?: SnapshotQualityVerdict;
  warnings?: string[];
};
type AndroidSnapshotBackendMetadata = {
  backend: 'android-helper';
  helperVersion?: string;
  helperApiVersion?: string;
  helperTransport?: string;
  helperSessionReused?: boolean;
  installReason?: string;
  waitForIdleTimeoutMs?: number;
  waitForIdleQuietMs?: number;
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  rootPresent?: boolean;
  captureMode?: string;
  systemSurfaceOnly?: boolean;
  windowCount?: number;
  nodeCount?: number;
  helperTruncated?: boolean;
  elapsedMs?: number;
  presentationFailure?: {
    phase: 'deadline' | 'complexity' | 'regular-invariant';
    workUnits: number;
    maxWorkUnits?: number;
  };
  /** API 23 exposes no sibling drawing order, so same-window occlusion fails conservative. */
  occlusionScanUnavailable?: boolean;
};
type FindLocator = 'any' | 'text' | 'label' | 'value' | 'role' | 'id';
//#endregion
//#region packages/contracts/src/click-button.d.ts
declare const CLICK_BUTTONS: readonly ['primary', 'secondary', 'middle'];
type ClickButton = (typeof CLICK_BUTTONS)[number];
//#endregion
//#region packages/contracts/src/scroll-gesture.d.ts
declare const SCROLL_INPUT_DIRECTIONS: readonly ['up', 'down', 'left', 'right', 'top', 'bottom'];
type ScrollInputDirection = (typeof SCROLL_INPUT_DIRECTIONS)[number];
declare const SCROLL_DIRECTIONS: readonly ['up', 'down', 'left', 'right'];
type ScrollDirection = (typeof SCROLL_DIRECTIONS)[number];
declare const SWIPE_PRESETS: readonly ['left', 'right', 'left-edge', 'right-edge'];
type SwipePreset = (typeof SWIPE_PRESETS)[number];
declare const SWIPE_PATTERNS: readonly ['one-way', 'ping-pong'];
type SwipePattern = (typeof SWIPE_PATTERNS)[number];
type TransformGestureParams = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  scale: number;
  degrees: number;
  durationMs?: number;
};
//#endregion
//#region packages/contracts/src/gesture-plan-types.d.ts
type GesturePointerCount = 1 | 2;
/** Selects one-pointer release timing without changing semantic gesture intent. */
type GestureExecutionProfile = 'endpoint-hold' | 'timed-pan';
type PointerTrajectorySample = {
  offsetMs: number;
  point: Point;
};
type PointerTrajectory = {
  pointerId: 0 | 1;
  samples: readonly PointerTrajectorySample[];
};
type SinglePointerTrajectory = {
  pointerId: 0;
  samples: readonly [PointerTrajectorySample, PointerTrajectorySample, ...PointerTrajectorySample[]];
};
type SinglePointerGesturePlan = {
  topology: 'single';
  intent: 'fling' | 'pan';
  executionProfile: GestureExecutionProfile;
  durationMs: number;
  viewport: Rect;
  pointers: readonly [SinglePointerTrajectory];
};
type MultiTouchGesturePlan = {
  topology: 'two';
  intent: 'pan' | 'pinch' | 'rotate' | 'transform';
  durationMs: number;
  viewport: Rect;
  pointers: readonly [PointerTrajectory, PointerTrajectory];
};
type GesturePlan = SinglePointerGesturePlan | MultiTouchGesturePlan;
//#endregion
//#region packages/contracts/src/back-mode.d.ts
declare const BACK_MODES: readonly ['in-app', 'system'];
type BackMode = (typeof BACK_MODES)[number];
//#endregion
//#region packages/contracts/src/settings.d.ts
/**
 * The `settings permission` vocabulary, declared once. These collections are what the parsers
 * below, the public client permission types, the CLI's membership sets, and the permission-name
 * fragments of `settings` help and its invalid-args message are built from, and their order is
 * the order `settings` help lists the names in.
 *
 * Acceptance is not support: each backend keeps its own target mapping and its own support check,
 * so a name accepted here never promises that the selected platform serves it.
 */
declare const PERMISSION_ACTIONS: readonly ['grant', 'deny', 'reset'];
declare const PERMISSION_MODES: readonly ['full', 'limited'];
/** The app-scoped targets, the only ones `parsePermissionTarget` accepts. */
declare const MOBILE_PERMISSION_TARGETS: readonly ['camera', 'microphone', 'photos', 'contacts', 'contacts-limited', 'notifications', 'calendar', 'location', 'location-always', 'media-library', 'motion', 'reminders', 'siri'];
/** The desktop targets the CLI and the public client accept; `parsePermissionTarget` refuses them. */
declare const MACOS_PERMISSION_TARGETS: readonly ['accessibility', 'screen-recording', 'input-monitoring'];
type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
type PermissionMode = (typeof PERMISSION_MODES)[number];
type SettingOptions = {
  permissionTarget?: string;
  permissionMode?: string;
  latitude?: number;
  longitude?: number;
};
//#endregion
//#region packages/contracts/src/device-rotation.d.ts
declare const DEVICE_ROTATIONS: readonly ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right'];
type DeviceRotation = (typeof DEVICE_ROTATIONS)[number];
//#endregion
//#region packages/contracts/src/tv-remote.d.ts
declare const TV_REMOTE_BUTTON_DEFINITIONS: {
  readonly up: {
    readonly aliases: readonly [];
    readonly androidKeyevent: 'KEYCODE_DPAD_UP';
    readonly appleRemoteButton: 'up';
    readonly vegaKey: 'KEY_UP';
  };
  readonly down: {
    readonly aliases: readonly [];
    readonly androidKeyevent: 'KEYCODE_DPAD_DOWN';
    readonly appleRemoteButton: 'down';
    readonly vegaKey: 'KEY_DOWN';
  };
  readonly left: {
    readonly aliases: readonly [];
    readonly androidKeyevent: 'KEYCODE_DPAD_LEFT';
    readonly appleRemoteButton: 'left';
    readonly vegaKey: 'KEY_LEFT';
  };
  readonly right: {
    readonly aliases: readonly [];
    readonly androidKeyevent: 'KEYCODE_DPAD_RIGHT';
    readonly appleRemoteButton: 'right';
    readonly vegaKey: 'KEY_RIGHT';
  };
  readonly select: {
    readonly aliases: readonly ["ok", "center", "enter"];
    readonly androidKeyevent: 'KEYCODE_DPAD_CENTER';
    readonly appleRemoteButton: 'select';
    readonly vegaKey: 'KEY_ENTER';
  };
  readonly menu: {
    readonly aliases: readonly [];
    readonly androidKeyevent: 'KEYCODE_MENU';
    readonly appleRemoteButton: 'menu';
    readonly vegaKey: 'KEY_MENU';
  };
  readonly home: {
    readonly aliases: readonly [];
    readonly androidKeyevent: 'KEYCODE_HOME';
    readonly appleRemoteButton: 'home';
    readonly vegaKey: 'KEY_HOMEPAGE';
  };
  readonly back: {
    readonly aliases: readonly [];
    readonly androidKeyevent: 'KEYCODE_BACK';
    readonly appleRemoteButton: 'menu';
    readonly vegaKey: 'KEY_BACK';
  };
};
declare const TV_REMOTE_BUTTONS: (keyof typeof TV_REMOTE_BUTTON_DEFINITIONS)[];
type TvRemoteButton = (typeof TV_REMOTE_BUTTONS)[number];
//#endregion
//#region packages/contracts/src/ios-system-surface.d.ts
/**
 * iOS out-of-process system surfaces that agent-device observes and drives IN PLACE, never by
 * activation: launching or activating the host cancels what it presents (issue #2438), so the
 * runner addresses the host process while it is foreground and the `open` path refuses it. The set
 * is deliberately closed and tiny; add a host only with live evidence that it presents out of
 * process and dies on activation. Rationale per host lives in the canonical fixture
 * `contracts/fixtures/ios-system-surface-hosts.json` (see also docs/adr/0004); this module and the
 * Swift `SystemSurfaceHostRegistry` both mirror it, each guarded by a parity test.
 */
/** Why a system surface is served in place; carried at snapshot-response level as provenance. */
type IosSystemSurfaceKind = 'web-auth' | 'payment';
/**
 * Whole-snapshot provenance: the capture describes a system surface presented over the session app,
 * not the app itself. Carried at response level (it applies to the entire snapshot) and folded into
 * iOS snapshot lineage so `--verify`/`--settle` never compare an app baseline against a sheet
 * capture. Mirrors the Android system-chrome/system-surface provenance model.
 */
type IosSystemSurfaceProvenance = Readonly<{
  bundleId: string;
  kind: IosSystemSurfaceKind;
}>;
//#endregion
//#region packages/contracts/src/interaction.d.ts
/** The decisive criterion separating a resolveSelectorChain winner from its strongest runner-up (ADR 0012). */
type DisambiguationTiebreak = 'visible' | 'deepest' | 'smallest-area' | 'structural-equivalence';
/**
 * A disambiguation winner or losing alternative. `diagnosticRef` is an opaque,
 * non-`@` token — never a snapshot ref, never issued via `refsGeneration`,
 * never pinnable or usable as an `@ref` target. Strings are UTF-8 truncated
 * to 256 bytes.
 */
type ResolutionDiagnosticEntry = {
  diagnosticRef: string;
  role?: string;
  label?: string;
};
/**
 * ADR 0012 decision 2: pre-action disclosure of how the acting path resolved
 * its target, including each endpoint of a target-authored drag. Never ref-issuing.
 * `direct-ios`/`not-observed` = the XCTest fast path has no daemon tree to
 * report from; `ref`/`label-fallback` = a stale `@ref` recovered via
 * first-match label lookup, never exact ref provenance; `alternatives` holds
 * at most 5 losing candidates, winner excluded.
 */
type ResolutionDisclosure = {
  source: 'runtime';
  phase: 'pre-action';
  kind: 'unique';
} | {
  source: 'runtime';
  phase: 'pre-action';
  kind: 'disambiguated';
  matchCount: number;
  winnerDiagnostic: ResolutionDiagnosticEntry;
  tiebreak: DisambiguationTiebreak;
  alternatives: ResolutionDiagnosticEntry[];
} | {
  source: 'ref';
  phase: 'pre-action';
  kind: 'exact';
} | {
  source: 'ref';
  phase: 'pre-action';
  kind: 'label-fallback';
} | {
  source: 'direct-ios';
  kind: 'not-observed';
};
/**
 * A post-action capture that describes a DIFFERENT surface than the pre-action baseline (#2438): an
 * in-place iOS system surface (a web sign-in or Apple Pay sheet, hosted out of the app's process)
 * was presented over the app, or left it. `from`/`to` name the two surfaces — a host bundle id, or
 * `APP_SURFACE` (`@agent-device/contracts/ios-system-surface`) for ordinary app content.
 *
 * Its presence IS the refusal of a same-surface claim: the two captures are not one presentation,
 * so `--verify` reports `changedFromBefore` from this transition instead of from a digest
 * comparison across it, and `--settle` attaches no settled diff (and therefore no refs) across it.
 */
type PostActionSurfaceChange = {
  from: string;
  to: string;
  /** The one agent-facing sentence for this transition (`@agent-device/contracts/ios-system-surface`). */
  disclosure: string;
};
/**
 * Opt-in (`--verify`) cheap post-condition evidence for mutating interaction
 * commands (#1047). `digest`/`nodeCount`/`interactiveNodeCount` describe a single
 * interactive-only capture taken right after the action; `changedFromBefore`
 * compares that digest against the pre-action capture the resolution path already
 * held, so no extra device round trip is spent beyond the one verify capture.
 * `changedFromBefore: false` is evidence, not failure — the command still
 * succeeded.
 *
 * When `surfaceChange` is present the two captures describe different surfaces, so the digest
 * comparison is not made at all: `changedFromBefore` then reports that transition, which replaced
 * the whole observed surface.
 */
type InteractionEvidence = {
  foregroundApp?: string;
  nodeCount: number;
  interactiveNodeCount: number;
  digest: string;
  changedFromBefore: boolean;
  surfaceChange?: PostActionSurfaceChange;
};
type SettleDiffLine = {
  kind: 'added' | 'removed';
  text: string;
  /**
   * Plain ref body (`e12`) for ADDED lines: minted from the settled tree that
   * became the stored session snapshot, so it is immediately actionable and
   * lets the MCP layer pin it at `refsGeneration`. Removed lines never carry
   * one — their refs name nodes of the replaced tree.
   */
  ref?: string;
};
/**
 * One still-present, actionable element on the settled tree, surfaced by the
 * unchanged-interactive tail (see `SettleObservation.tail`).
 */
type SettleTailEntry = {
  ref: string;
  role: string;
  label?: string;
};
type SettleObservation = {
  settled: boolean;
  waitedMs: number;
  captures: number;
  quietMs: number;
  timeoutMs: number;
  /**
   * The session's snapshot generation after the settled tree became the stored
   * snapshot (#1076 versioned refs). Attached by the daemon response layer
   * when `diff` is present: added lines carry refs minted from that tree, so
   * the response is ref-issuing — the MCP layer merges per-ref pins from it
   * exactly like snapshot/find responses.
   */
  refsGeneration?: number;
  /**
   * Digest response view only: capped added-line refs preserved without the
   * verbose diff line text, so MCP can still pin refs when `diff.lines` is
   * intentionally omitted.
   */
  refs?: Array<{
    ref: string;
  }>;
  /**
   * Present when the settled capture describes a different surface than the pre-action baseline
   * (#2438). The settled tree then replaced the whole surface rather than changing within one, so
   * `diff` is omitted: its lines (and their refs) would present a surface replacement as an
   * in-surface change. `hint` says what to do instead.
   */
  surfaceChange?: PostActionSurfaceChange;
  /**
   * Present only for `settled: true` observations that stored the settled tree, and never across a
   * `surfaceChange` — a diff describes change WITHIN one surface.
   */
  diff?: {
    summary: {
      additions: number;
      removals: number;
      unchanged: number;
    };
    lines: SettleDiffLine[];
    /** Present (true) when lines were capped to the response bound. */
    truncated?: boolean;
  };
  /**
   * Unchanged interactive refs tail: benchmarks (July 2026) showed 27% of
   * `--settle` actions were followed by a fallback `snapshot -i` because a
   * change-only diff omits refs for elements that did not change — after a
   * modal dismiss the diff shows only removals, and the next button to press
   * (already on screen, untouched) is absent from the response. `tail` lists
   * the settled tree's remaining uncovered interactive elements (excluding
   * structural application/window chrome and the keyboard window's chrome)
   * so the response stays actionable without that extra round trip. Attached
   * ONLY when `diff` carries zero added-line refs naming a NEW target (the
   * modal-dismiss/toast-only/fill signature) — a diff whose added refs hand
   * the next target already pays its way, so the tail would be pure byte
   * cost. Keyboard-chrome refs and self-echo refs (added lines whose node
   * contains the action point: the acted-on element re-describing itself,
   * e.g. a filled field re-labeled with its new value) do not count as new
   * targets. Refs already present on `diff`'s added lines are excluded.
   * Capped; `tailTruncated` marks when candidates exceeded the cap.
   */
  tail?: SettleTailEntry[];
  tailTruncated?: true;
  hint?: string;
};
/**
 * Public daemon response data shared by press/click/fill/longpress.
 * `buildInteractionResponseData` emits this shape (ADR 0011 Layer 2):
 * `targetKind` discriminates the resolved target, identity fields are FLAT
 * (`ref`, `selector`, `x`, `y`), and per-command extras ride alongside.
 */
type TouchResponseDataBase = {
  message?: string;
  warning?: string;
  x?: number;
  y?: number;
  referenceWidth?: number;
  referenceHeight?: number;
  evidence?: InteractionEvidence;
  settle?: SettleObservation;
  resolution?: ResolutionDisclosure;
  cost?: ResponseCost;
  /** Direct iOS Maestro coordinate-fallback signals. */
  maestroNonHittableCoordinateFallbackAllowed?: boolean;
  maestroNonHittableCoordinateFallbackUsed?: boolean;
  maestroFallbackReason?: 'non-hittable-coordinate';
};
type TouchResponsePoint = TouchResponseDataBase & {
  targetKind: 'point';
  x: number;
  y: number;
};
type TouchResponseRef = TouchResponseDataBase & {
  targetKind: 'ref';
  ref: string;
  refLabel?: string;
  selectorChain?: string[];
  targetHittable?: boolean;
  hint?: string;
};
type TouchResponseSelector = TouchResponseDataBase & {
  targetKind: 'selector';
  selector: string;
  selectorChain?: string[];
  refLabel?: string;
  targetHittable?: boolean;
  hint?: string;
};
type TouchPressExtras = {
  button?: ClickButton;
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};
type PressCommandResponseData = (TouchResponsePoint & TouchPressExtras) | (TouchResponseRef & TouchPressExtras) | (TouchResponseSelector & TouchPressExtras);
type ClickCommandResponseData = PressCommandResponseData;
type TouchFillExtras = {
  text: string;
  delayMs?: number;
} & ({
  verification?: never;
  requested?: never;
  before?: never;
  after?: never;
  target?: never;
} | FillUnconfirmedVerification);
type FillCommandResponseData = (TouchResponsePoint & TouchFillExtras) | (TouchResponseRef & TouchFillExtras) | (TouchResponseSelector & TouchFillExtras);
type TouchLongPressExtras = {
  durationMs?: number;
  gesture: 'longpress';
};
type LongPressCommandResponseData = (TouchResponsePoint & TouchLongPressExtras) | (TouchResponseRef & TouchLongPressExtras) | (TouchResponseSelector & TouchLongPressExtras);
type TouchHoverExtras = {
  gesture: 'hover';
};
type HoverCommandResponseData = (TouchResponsePoint & TouchHoverExtras) | (TouchResponseRef & TouchHoverExtras) | (TouchResponseSelector & TouchHoverExtras);
/**
 * Daemon response data for the `find` command. Read-only actions (`exists`,
 * `wait`, `get_text`, `get_attrs`) may issue a pinnable ref with
 * `refsGeneration`; mutating actions (`click`, `fill`, `focus`, `type`) carry
 * `ref` as diagnostic pre-action identity and intentionally omit `refsGeneration`
 * (ADR 0014). The shape is intentionally a flat, optional-field record because
 * the action positional changes which fields are present.
 */
type FindCommandResponseData = {
  ref?: string;
  refsGeneration?: number;
  found?: true;
  waitedMs?: number;
  text?: string;
  node?: SnapshotNode;
  /** Every match of the read-only `list` action (#1625), each ref pinnable at `refsGeneration`. */
  matches?: Array<{
    ref: string;
    node: SnapshotNode;
  }>;
  locator?: string;
  query?: string;
  x?: number;
  y?: number;
  message?: string;
  settle?: SettleObservation;
  cost?: ResponseCost;
};
//#endregion
//#region packages/contracts/src/scroll-command.d.ts
type ScrollReleaseBehavior = 'controlled' | 'inertial';
type ScrollDistanceOptions = {
  amount?: number;
  pixels?: number;
};
type ScrollTimingOptions = {
  durationMs?: number;
};
type ScrollCommandOptions = ScrollDistanceOptions & ScrollTimingOptions;
type ScrollExecutionOptions = ScrollCommandOptions & {
  releaseBehavior?: ScrollReleaseBehavior;
};
/**
 * `scroll` — the generic-route result built by `buildDispatchedScrollResult`
 * (src/core/dispatch-scroll.ts): the resolved direction, the edge-pass
 * bookkeeping for `top`/`bottom` scrolls, the honored distance/timing echo,
 * and the success message. Platform leaves add gesture-plan coordinates
 * (`x1`/`y1`/`x2`/`y2`, reference frame) on top; the output schema stays
 * non-strict so those additive fields validate. The one field the dispatcher
 * itself may add: `settle`, the opt-in `--settle` observation (#1638),
 * attached after the command — same shape as `BackCommandResult`.
 */
type ScrollCommandResult = {
  direction: ScrollDirection;
  /** Set for `top`/`bottom` requests: the extreme being scrolled to. */
  edge?: 'top' | 'bottom';
  /** Set for `--until` requests: the selector the passes stopped on. */
  until?: string;
  /** Edge and until scrolls only: how many scroll-and-check passes ran. */
  passes?: number;
  amount?: number;
  pixels?: number;
  durationMs?: number;
  message?: string;
  settle?: SettleObservation;
  /**
   * Set only when an on-screen keyboard made the owner clip the swipe into the band above it
   * (#2500). Absent means the swipe was not clipped, which is not the same claim as `false`: a
   * platform that never runs the clip has nothing to report. The platform leaf's `referenceHeight`
   * names the shortened axis the reported `pixels` were planned against, and `keyboardMinY` names
   * where the keyboard began. A surface the owner refused to swipe at all fails instead, under the
   * `scroll_keyboard_occludes_surface` reason.
   */
  keyboardAvoided?: true;
  /** The keyboard's edge in the same unit as the gesture coordinates, when the swipe was clipped. */
  keyboardMinY?: number;
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
//#region packages/contracts/src/ios-snapshot.d.ts
type IosSnapshotProducer = 'apple-runner' | 'simulator-ax-bridge' | 'appium-source' | 'limrun-ios-tree';
type IosAcquisitionProducer = Exclude<IosSnapshotProducer, 'apple-runner'>;
type IosAcquisitionIntent = 'full' | 'surface-observation';
type IosSnapshotProjection = 'regular' | 'raw';
type IosSnapshotGeneration = string;
type IosSnapshotLineage = Readonly<{
  targetId?: string;
  generation?: IosSnapshotGeneration;
}>;
type IosSnapshotPresentationKey = Readonly<{
  projection: IosSnapshotProjection;
  interactiveOnly: boolean;
  depth: number | null;
  scope: string | null;
  customActions: boolean;
}>;
type CaptureHint = Readonly<{
  projection: IosSnapshotProjection;
  rawTraversalDepth: number | null;
  regularPresentedDepth: number | null;
  interactiveOnly: boolean;
  customActions: boolean;
  acquisitionIntent: IosAcquisitionIntent;
}>;
type IosSnapshotFact = 'acquisition-depth' | 'scope' | 'interactive-query' | 'viewport' | 'hittability' | 'generation' | 'truncation';
type IosViewportEvidence = Readonly<{
  kind: 'reported';
  rect: Rect;
}> | Readonly<{
  kind: 'derived';
  rect: Rect;
}> | Readonly<{
  kind: 'missing';
  reason: 'not-provided' | 'not-supported' | 'invalid';
}>;
type IosProviderPrunedField = 'nodes' | 'depth' | 'scope' | 'interactive-only';
type IosAcquisitionResidue = Readonly<{
  kind: 'provider-pruned';
  fields: readonly IosProviderPrunedField[];
}> | Readonly<{
  kind: 'missing-viewport';
  reason: 'not-provided' | 'not-supported' | 'invalid';
}> | Readonly<{
  kind: 'truncated';
}> | Readonly<{
  kind: 'stale-generation';
  expected?: IosSnapshotGeneration;
  observed?: IosSnapshotGeneration;
}> | Readonly<{
  kind: 'unknown-generation';
  captureId: string;
}> | Readonly<{
  kind: 'unavailable-fact';
  fact: IosSnapshotFact;
}> | Readonly<{
  kind: 'fallback-source';
  producer: IosSnapshotProducer;
}>;
type IosSnapshotAcquisitionForIntent<Intent extends IosAcquisitionIntent> = Readonly<{
  producer: IosAcquisitionProducer;
  intent: Intent;
  hint: CaptureHint & Readonly<{
    acquisitionIntent: Intent;
  }>;
  nodes: readonly RawSnapshotNode[];
  truncated?: boolean;
  viewport: IosViewportEvidence;
  lineage: IosSnapshotLineage;
  residue: readonly IosAcquisitionResidue[];
}>;
type IosSnapshotAcquisition = IosSnapshotAcquisitionForIntent<'full'> | IosSnapshotAcquisitionForIntent<'surface-observation'>;
type IosSnapshotAcquisitionFacts = Omit<IosSnapshotAcquisition, 'hint'>;
type IosSnapshotComparisonIdentity = Readonly<{
  producer: IosSnapshotProducer;
  intent: IosAcquisitionIntent;
  lineage: IosSnapshotLineage;
  presentationKey: IosSnapshotPresentationKey;
  residue: readonly IosAcquisitionResidue[];
}>;
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
type PressPointOptions = Readonly<{
  button: 'primary' | 'secondary' | 'middle';
  count: number;
  intervalMs: number;
  holdMs: number;
  jitterPx: number;
  doubleTap: boolean;
  surface?: SessionSurface;
}>;
/**
 * The channel the XCTest runner actually entered text through — the Swift
 * `TextEntryResult.textEntryRoute` (RunnerTests+TextTyping.swift,
 * RunnerTests+SynthesizedTextEntry.swift). Closed set, because the runner is
 * its only producer and the boundary that narrows it
 * (readTypeTextBackendResult, packages/platform-apple/src/interactions.ts) drops a
 * route it cannot name — so a Swift-side addition would silently vanish. The
 * route-parity test in packages/platform-apple/src/core/__tests__/interactions.test.ts
 * reads the Swift sources and fails instead.
 */
declare const TEXT_ENTRY_ROUTES: readonly ['xctest-element', 'synthesized-first-responder', 'synthesized-first-responder-replacement', 'xctest-application-fallback'];
type TextEntryRoute = (typeof TEXT_ENTRY_ROUTES)[number];
/**
 * What `Interactor.type` reports back about the entry it performed. Only the
 * Apple runner populates it; every other platform types blind and returns void.
 */
type TypeTextBackendResult = {
  textEntryRoute?: TextEntryRoute;
};
type FillVerificationTarget = {
  resourceId: string | null;
  className: string | null;
  packageName: string | null;
  rect: Rect;
};
type FillUnconfirmedVerification = {
  verification: 'unconfirmed';
  requested: string;
  before: string | null;
  after: string | null;
  target: FillVerificationTarget;
};
type SnapshotOptions = SnapshotOptions$1 & {
  appBundleId?: string;
  signal?: AbortSignal;
  includeRects?: boolean;
  includeHiddenContentHints?: boolean;
  surface?: SessionSurface;
  /** Internal capture purpose; action outcomes always require the full tree. */
  acquisitionIntent?: 'full' | 'surface-observation';
};
/**
 * Android's live IME status read. Optional on {@link Interactor}: parity with the retired leaf,
 * which refused `status`/`get` on every other family (no other platform's runner exposes one).
 * A single-member discriminated union rather than a bare object so the daemon can derive its wire
 * `platform` label from `kind` the same way it does for dismiss and enter — an owner can only ever
 * produce its own result shape.
 */
type KeyboardStatusResult = Readonly<{
  kind: 'ime-probe';
  visible: boolean;
  inputType?: string;
  type?: string;
  inputMethodPackage?: string;
  focusedPackage?: string;
  focusedResourceId?: string;
  inputOwner?: string;
}>;
/**
 * Owner-shaped dismiss evidence, discriminated by which owner produced it: Android's IME probe
 * fields, or iOS's `mechanism` disclosure (#1598), or HarmonyOS's bare acknowledgment (its HDC
 * key press reports nothing beyond success). The daemon derives the wire `platform` label from
 * `kind` rather than re-deriving it from the device, so an owner can only ever produce its own
 * result shape — an android-probe result under an `ios` label is unrepresentable.
 */
type KeyboardDismissResult = Readonly<{
  kind: 'ime-probe';
  attempts?: number;
  wasVisible?: boolean;
  dismissed?: boolean;
  visible?: boolean;
  inputType?: string;
  type?: string;
  inputMethodPackage?: string;
  focusedPackage?: string;
  focusedResourceId?: string;
  inputOwner?: string;
}> | Readonly<{
  kind: 'mechanism';
  wasVisible?: boolean;
  dismissed?: boolean;
  visible?: boolean;
  mechanism?: string;
}> | Readonly<{
  kind: 'acknowledged';
}>;
/**
 * Only the Apple runner echoes visibility around the return-key press; Android and HarmonyOS
 * acknowledge with no fields beyond success. Kind is owner-specific, not just content-shaped —
 * Android's and HarmonyOS's acknowledgments are structurally identical, so only the discriminant
 * itself tells the daemon which owner actually pressed enter.
 */
type KeyboardEnterResult = Readonly<{
  kind: 'visibility-echo';
  visible?: boolean;
  wasVisible?: boolean;
}> | Readonly<{
  kind: 'android-acknowledged';
}> | Readonly<{
  kind: 'harmonyos-acknowledged';
}>;
/**
 * Every acquisition carries its provenance pair atomically: the channel alone cannot say who
 * acquired the tree or which guarantees it carries, and `SnapshotProvenance`
 * (`@agent-device/kernel/snapshot`) makes a cross-channel `backend`/`producer` combination
 * fail to compile.
 */
type SnapshotResult = Omit<BackendSnapshotResult, 'backend' | 'nodes'> & {
  nodes?: RawSnapshotNode[];
  comparisonIdentity?: IosSnapshotComparisonIdentity;
  /**
   * Set when the capture describes an in-place iOS system surface (a web sign-in sheet) presented
   * over the session app rather than the app itself (#2438).
   */
  systemSurface?: IosSystemSurfaceProvenance;
  /**
   * The keyboard band the producer measured while capturing, when it can measure one (#2660). A
   * producer that publishes nothing measured nothing, so the tap-path guard keeps deriving the band
   * from `nodes`; see {@link SnapshotKeyboardBandFact}.
   */
  keyboard?: SnapshotKeyboardBandFact;
  /**
   * Set when this capture's own command had to bring the session app back to the foreground, i.e.
   * something else held it and an earlier observation described that instead (#2682).
   */
  targetActivation?: IosTargetActivation;
} & SnapshotProvenance;
type SnapshotRuntimeAcquiredResult = Readonly<{
  stage: 'acquired';
  acquisition: IosSnapshotAcquisitionFacts & Readonly<{
    producer: IosAcquisitionProducer;
  }>;
}>;
type SnapshotRuntimeResult = SnapshotResult | SnapshotRuntimeAcquiredResult;
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
  /** Complete point-press semantics for owners with fused series, alternate buttons, or surfaces. */
  pressPoint?(point: Point, options: PressPointOptions): Promise<Record<string, unknown> | void>;
  /** Alternate mouse buttons for owners that otherwise use the shared point-press series. */
  alternateClick?(point: Point, button: 'secondary' | 'middle'): Promise<Record<string, unknown> | void>;
  /** Owner-native ref routes; currently the managed web runtime is their only local owner. */
  tapRef?(ref: string): Promise<Record<string, unknown> | void>;
  tapElementSelector?(selector: ElementSelectorTapOptions): Promise<Record<string, unknown> | void>;
  doubleTap(x: number, y: number): Promise<Record<string, unknown> | void>;
  longPress(x: number, y: number, durationMs?: number): Promise<Record<string, unknown> | void>;
  /**
   * Move the pointer to a point without pressing. Only pointer-driven
   * platforms (web today) implement it; touch platforms have no hover state
   * and leave it undefined, which the `hover` command reports as unsupported.
   */
  hover?(x: number, y: number): Promise<Record<string, unknown> | void>;
  hoverRef?(ref: string): Promise<Record<string, unknown> | void>;
  focus(x: number, y: number): Promise<Record<string, unknown> | void>;
  type(text: string, delayMs?: number): Promise<TypeTextBackendResult | void>;
  /**
   * Replace the target's text with `text`. The empty string is the clear request (#2063), not a
   * no-op: an implementation must empty the field or fail — never report success over an
   * untouched value. A backend with no clear mechanism refuses the empty text up front (see the
   * webdriver interactor).
   */
  fill(x: number, y: number, text: string, delayMs?: number, options?: {
    allowNonHittableCoordinateFallback?: boolean;
  }): Promise<Record<string, unknown> | void>;
  fillRef?(ref: string, text: string, delayMs?: number): Promise<Record<string, unknown> | void>;
  scroll(direction: ScrollDirection, options?: ScrollExecutionOptions): Promise<Record<string, unknown> | void>;
  screenshot(outPath: string, options?: ScreenshotOptions): Promise<void>;
  setViewport?(width: number, height: number): Promise<Record<string, unknown> | void>;
  snapshot(options?: SnapshotOptions): Promise<SnapshotRuntimeResult>;
  /**
   * Native reading of the live text at a point, when the backend has one. Answers the text the
   * owner can see right now, which can exceed what an already-captured node carries (an editable
   * field whose value is longer than its label). Optional: a backend without it leaves the
   * captured tree as the complete answer.
   */
  readTextAtPoint?(point: Point, options?: {
    appBundleId?: string;
    surface?: SessionSurface;
    signal?: AbortSignal;
  }): Promise<string | undefined>;
  /**
   * Native text-presence reading, when the backend has one that does not require a tree capture.
   * A `true` answer is authoritative; anything else means "not proven here" and the caller
   * consults the canonical tree (see `FindTextResult`).
   */
  findText?(text: string, options?: {
    appBundleId?: string;
    signal?: AbortSignal;
  }): Promise<{
    found: boolean;
  }>;
  gestureViewport?(): Promise<Rect>;
  back(mode?: BackMode): Promise<void>;
  home(): Promise<void>;
  setOrientation(orientation: DeviceRotation): Promise<{
    orientation?: DeviceRotation;
  } | void>;
  performGesture?(plan: GesturePlan): Promise<Record<string, unknown> | void>;
  appSwitcher(): Promise<void>;
  tvRemote(button: TvRemoteButton, durationMs?: number): Promise<void>;
  /**
   * Presses the iPhone Action Button. Required rather than optional for the same reason `tvRemote`
   * is: an absent member would let an advertised press resolve as a no-op that reports success.
   * Owners without the button throw `UNSUPPORTED_OPERATION`.
   */
  actionButton(): Promise<void>;
  /** Optional: only Android implements a live status read (see {@link KeyboardStatusResult}). */
  keyboardStatus?(): Promise<KeyboardStatusResult>;
  /** Optional: platforms with no keyboard-dismiss concept leave it undefined. */
  keyboardDismiss?(): Promise<KeyboardDismissResult>;
  /** Optional: platforms with no keyboard-return concept leave it undefined. */
  keyboardEnter?(): Promise<KeyboardEnterResult>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  pasteClipboard?(text: string, selector: Pick<ElementSelectorTapOptions, 'key' | 'value'>): Promise<string>;
  copyClipboard?(selector: Pick<ElementSelectorTapOptions, 'key' | 'value'>, expectedText?: string): Promise<string>;
  setSetting(setting: string, state: string, appId?: string, options?: SettingOptions): Promise<Record<string, unknown> | void>;
  /**
   * The four alert legs. Each owner runs its own observation and, where it needs one, its own
   * poll: an alert is a transient device surface, and how long to look for it — and how to press
   * its buttons — is family mechanics, not something a caller can supply. `timeoutMs` is the
   * whole window the caller allows; the owner spends it however its backend requires.
   */
  readAlert(options?: AlertInteractorOptions): Promise<Record<string, unknown>>;
  awaitAlert(options?: AlertInteractorOptions): Promise<Record<string, unknown>>;
  acceptAlert(options?: AlertInteractorOptions): Promise<Record<string, unknown>>;
  dismissAlert(options?: AlertInteractorOptions): Promise<Record<string, unknown>>;
};
/**
 * The session-derived target one alert leg acts on. `appBundleId` is separate from the runner
 * context's because the macOS helper reads a frontmost-app surface with no bundle at all, and
 * the two must not collapse into one field that means both.
 */
type AlertInteractorOptions = {
  timeoutMs?: number;
  appBundleId?: string;
  surface?: SessionSurface;
};
//#endregion
//#region packages/selectors/src/internal/parse.d.ts
type SelectorKey = 'id' | 'role' | 'text' | 'label' | 'value' | 'appname' | 'windowtitle' | 'visible' | 'hidden' | 'editable' | 'selected' | 'focused' | 'enabled' | 'hittable';
type SelectorTerm = {
  key: SelectorKey;
  value: string | boolean;
};
type Selector = {
  raw: string;
  terms: SelectorTerm[];
};
type SelectorChain = {
  raw: string;
  selectors: Selector[];
};
declare function parseSelectorChain(expression: string): SelectorChain;
declare function tryParseSelectorChain(expression: string): SelectorChain | null;
declare function isSelectorToken(token: string): boolean;
//#endregion
//#region packages/selectors/src/internal/public-resolution-types.d.ts
/** One per-alternative diagnostic returned by selector resolution. */
type SelectorDiagnostics = {
  selector: string;
  matches: number;
};
/**
 * The disclosure for an ambiguous selector that was resolved by the heuristic;
 * present only when the heuristic picked among N>1 matches (ADR 0012).
 */
type SelectorDisambiguationDisclosure = {
  matchCount: number;
  tiebreak: DisambiguationTiebreak;
  /** Every losing matched node, document order, uncapped (response layer caps). */
  alternatives: SnapshotNode[];
};
/**
 * The options every selector lookup takes. Stated once here rather than inline
 * per function so a façade wrapper and the parser-side function it forwards to
 * cannot drift apart.
 */
type SelectorMatchOptions = {
  platform: Platform | PublicPlatform;
  requireRect?: boolean;
};
/** {@link SelectorMatchOptions} plus the uniqueness policy resolution adds. */
type SelectorResolutionOptions = SelectorMatchOptions & {
  requireUnique?: boolean;
  disambiguateAmbiguous?: boolean;
};
//#endregion
//#region packages/selectors/src/internal/resolve.d.ts
/**
 * The parser-side twin of the façade's `SelectorResolution`: identical except
 * that the winning alternative is the `Selector` node itself, which the façade
 * flattens to its `raw` text before any consumer sees it. Only the fields that
 * differ are restated; everything else is shared with
 * `public-resolution-types.ts`.
 */
type AstSelectorResolution = {
  node: SnapshotNode;
  selector: Selector;
  selectorIndex: number;
  matches: number;
  diagnostics: SelectorDiagnostics[];
  disambiguation?: SelectorDisambiguationDisclosure;
};
declare function resolveSelectorChain(nodes: SnapshotState['nodes'], chain: SelectorChain, options: SelectorResolutionOptions): AstSelectorResolution | null;
/**
 * A first-match lookup used by existence checks. No façade twin: the root
 * façade resolves through the policy interface only, so this shape reaches
 * consumers via the published `./ast` surface alone (#1630).
 */
type AstSelectorChainMatch = {
  selectorIndex: number;
  selector: Selector;
  matches: number;
  diagnostics: SelectorDiagnostics[];
};
declare function findSelectorChainMatch(nodes: SnapshotState['nodes'], chain: SelectorChain, options: SelectorMatchOptions): AstSelectorChainMatch | null;
//#endregion
//#region packages/selectors/src/internal/node.d.ts
declare function isNodeVisible(node: SnapshotNode): boolean;
declare function isNodeEditable(node: SnapshotNode, platform: Platform | PublicPlatform): boolean;
//#endregion
//#region packages/selectors/src/ast.d.ts
/**
 * The published signature takes a parsed chain or the raw text it came from;
 * the engine only ever needs the text. Kept here rather than widening
 * `internal/resolve.ts` back to a union, so the compatibility obligation sits
 * at the boundary that owes it.
 */
declare function formatSelectorFailure(chain: SelectorChain | string, diagnostics: SelectorDiagnostics[], options: {
  unique?: boolean;
}): string;
//#endregion
export { PointerTrajectory as A, FindLocator as B, MACOS_PERMISSION_TARGETS as C, BackMode as D, PermissionMode as E, SwipePattern as F, SnapshotDiagnosticsSummary as H, SwipePreset as I, TransformGestureParams as L, SinglePointerGesturePlan as M, ScrollDirection as N, GesturePointerCount as O, ScrollInputDirection as P, ClickButton as R, DeviceRotation as S, PermissionAction as T, SessionSurface as U, ScreenshotResultData as V, HoverCommandResponseData as _, resolveSelectorChain as a, SettleObservation as b, isSelectorToken as c, Interactor as d, RunnerContext as f, FindCommandResponseData as g, FillCommandResponseData as h, findSelectorChainMatch as i, PointerTrajectorySample as j, MultiTouchGesturePlan as k, parseSelectorChain as l, ClickCommandResponseData as m, isNodeEditable as n, SelectorDiagnostics as o, ScrollCommandResult as p, isNodeVisible as r, SelectorChain as s, formatSelectorFailure as t, tryParseSelectorChain as u, LongPressCommandResponseData as v, MOBILE_PERMISSION_TARGETS as w, TvRemoteButton as x, PressCommandResponseData as y, AndroidSnapshotBackendMetadata as z };