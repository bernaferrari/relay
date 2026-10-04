import { L as SnapshotQualityVerdict, P as SnapshotNode, R as SnapshotState, T as PublicPlatform, j as ScreenshotOverlayRef, n as DaemonArtifactType } from "./sdk-contracts.js";
import { _ as SettleObservation } from "./sdk-selectors.js";
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
  /**
   * Physical pixels per density-independent pixel of the display the bounds are measured on, as
   * the helper's `DisplayMetrics` report it (2.625 on a 420 dpi phone). Node rects and the points
   * `press` takes stay in physical pixels; a consumer that lays out in dp divides by it. Absent on
   * an older helper.
   */
  pixelDensity?: number;
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
//#region packages/contracts/src/cloud-artifacts.d.ts
declare const CLOUD_ARTIFACT_KINDS: readonly ['video', 'appium-log', 'device-log', 'automation-log', 'provider-session', 'raw'];
type CloudArtifactKind = (typeof CLOUD_ARTIFACT_KINDS)[number];
type CloudArtifactAvailability = 'ready' | 'pending' | 'unavailable' | 'expired';
type CloudArtifact = {
  provider: string;
  kind: CloudArtifactKind;
  name: string;
  url?: string;
  providerSessionId?: string;
  providerArtifactId?: string;
  contentType?: string;
  extension?: string;
  availability?: CloudArtifactAvailability;
  metadata?: Record<string, unknown>;
};
type CloudArtifactsStatus = 'ready' | 'pending' | 'unavailable';
type CloudArtifactsResult = {
  provider: string;
  status: CloudArtifactsStatus;
  cloudArtifacts: CloudArtifact[];
  providerSessionId?: string;
  message?: string;
};
type DaemonArtifactInventoryEntry = {
  id: string;
  artifactType?: DaemonArtifactType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
};
type DaemonArtifactsResult = {
  source: 'daemon';
  status: 'ready';
  artifacts: DaemonArtifactInventoryEntry[];
  message?: string;
};
type AgentArtifactsResult = CloudArtifactsResult | DaemonArtifactsResult;
type CloudArtifactsQuery = {
  provider?: string;
  leaseId?: string;
  providerSessionId?: string;
};
type CloudProviderSessionResult = {
  provider?: string;
  providerSessionId?: string;
  cloudArtifacts?: CloudArtifactsResult;
} & Record<string, unknown>;
/**
 * Return undefined only when this provider implementation does not handle the query.
 * Return a CloudArtifactsResult with status "unavailable" when the provider handled the
 * query but artifact retrieval failed, and "pending" when artifacts are not finalized yet.
 */
type CloudArtifactProvider = {
  listCloudArtifacts?: (query: CloudArtifactsQuery) => Promise<CloudArtifactsResult | undefined>;
};
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
declare const MOBILE_PERMISSION_TARGETS: readonly ['all', 'camera', 'microphone', 'photos', 'contacts', 'contacts-limited', 'notifications', 'calendar', 'location', 'location-always', 'media-library', 'motion', 'reminders', 'siri'];
/** The desktop targets the CLI and the public client accept; `parsePermissionTarget` refuses them. */
declare const MACOS_PERMISSION_TARGETS: readonly ['accessibility', 'screen-recording', 'input-monitoring'];
type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
type PermissionMode = (typeof PERMISSION_MODES)[number];
/**
 * The preferred-text-size ladder `settings text-size` accepts, in the order `settings` help lists
 * it. Apple serves it natively — `simctl ui <device> content_size` reads and writes exactly these
 * names — and Android serves it through its `system font_scale` multiplier, so this ladder is the
 * cross-platform vocabulary and each owner maps it in its own native terms. Acceptance is not
 * support: an owner that cannot serve the ladder refuses at admission, on its own fact.
 */
declare const TEXT_SIZE_CATEGORIES: readonly ['extra-small', 'small', 'medium', 'large', 'extra-large', 'extra-extra-large', 'extra-extra-extra-large', 'accessibility-medium', 'accessibility-large', 'accessibility-extra-large', 'accessibility-extra-extra-large', 'accessibility-extra-extra-extra-large'];
type TextSizeCategory = (typeof TEXT_SIZE_CATEGORIES)[number];
/**
 * The settings that answer a bare `settings <setting>` with the value the target holds. This is the
 * vocabulary every settings type and every settings owner reads it from; the matching value is
 * `READABLE_SETTINGS` in `platform-runtime-operations.ts`, where the CLI hub can evaluate it, and
 * that module pins the two equal in both directions at compile time.
 */
type ReadableSetting = 'text-size';
/**
 * What `text-size` answers with. The ladder is shared across platforms, so a read names the
 * category the ladder calls the device's value *and* the value the platform itself reported: an
 * Apple content-size name, or an Android `font_scale` multiplier. The ladder is coarser than any
 * one platform's own scale, and `platformValue` is what keeps a normalized answer auditable.
 */
type TextSizeSettingPayload = Readonly<{
  setting: 'text-size';
  category: TextSizeCategory;
  platformValue: string;
}>;
/**
 * The payload a readable setting answers with, keyed by the setting that answered. Each readable
 * setting has its own shape — a category and a multiplier are not the same observation — so the
 * discriminant is what lets a response be composed, recorded, and printed from one place without
 * assuming every setting is a ladder rung. A second readable setting joins this union and supplies
 * its own sentence in `describeSettingRead`, which is where the compiler then asks for it.
 */
type ReadSettingResult = TextSizeSettingPayload;
type SettingOptions = {
  permissionTarget?: string;
  permissionMode?: string;
  latitude?: number;
  longitude?: number;
};
//#endregion
//#region packages/contracts/src/back-mode.d.ts
declare const BACK_MODES: readonly ['in-app', 'system'];
type BackMode = (typeof BACK_MODES)[number];
//#endregion
//#region packages/contracts/src/device-rotation.d.ts
declare const DEVICE_ROTATIONS: readonly ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right'];
type DeviceRotation = (typeof DEVICE_ROTATIONS)[number];
/**
 * The three hinge poses a foldable Apple device can be put in, named after what an agent sees
 * rather than after Apple's `UIHinge.Status` cases: `closed` lights the outer panel only,
 * `half-open` and `open` light the inner panel. Device Hub calls them Closed, Book, and Open;
 * `UIHinge.Status` calls them `.closed`, `.partiallyOpen`, and `.fullyOpen`.
 */
declare const FOLD_POSES: readonly ['closed', 'half-open', 'open'];
type FoldPose = (typeof FOLD_POSES)[number];
type FoldKeyframe = Readonly<{
  atMs: number;
  angle: number;
}>;
type SetFoldPoseInput = Readonly<{
  pose: FoldPose;
  keyframes?: never;
}> | Readonly<{
  keyframes: readonly FoldKeyframe[];
  pose?: never;
}>;
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
//#region packages/contracts/src/scroll-command.d.ts
type ScrollReleaseBehavior = 'controlled' | 'inertial';
/**
 * What a directional scroll actually SAW after its gesture, which is the only evidence that can
 * back the distance the same response reports (#2714).
 *
 * - `'moved'`: the post-gesture surface differs from the pre-gesture one, so content did move.
 * - `'at-edge'`: the surface is identical and the resolved container names no hidden content in
 *   that direction — the scroll was a legitimate no-op at the end of the content.
 * - `'unchanged'`: the surface is identical and the direction has no end-of-content signal to read
 *   (a horizontal scroll: the hidden-content analyzer only covers the vertical axis), so the
 *   response says what it measured without guessing which of the two it was.
 * - `'unobserved'`: nothing comparable was available, so the distance rests on the gesture plan
 *   alone. Callers that need the effect confirmed ask for a capture or a `--settle` observation.
 *
 * A directional scroll that measures an unchanged surface WITH hidden content still in that
 * direction does not answer at all: it fails with `scroll_no_progress`.
 */
type ScrollMovementObservation = 'moved' | 'at-edge' | 'unchanged' | 'unobserved';
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
   * The observation that gated this response's distance claim. See
   * {@link ScrollMovementObservation}: `scroll` answers with what it measured after the gesture,
   * and only `'moved'` and `'at-edge'` confirm the surface's fate. Absent on the tiers that verify
   * per pass instead of per gesture (`scroll top`/`bottom` and `--until`), and on platforms whose
   * scroll owner never dispatches a swipe (the Linux wheel).
   */
  movement?: ScrollMovementObservation;
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
export { TransformGestureParams as C, ScreenshotResultData as D, FindLocator as E, SnapshotDiagnosticsSummary as O, SwipePreset as S, BackendSnapshotResult as T, CloudArtifactProvider as _, FoldPose as a, ScrollInputDirection as b, MACOS_PERMISSION_TARGETS as c, PermissionMode as d, ReadSettingResult as f, AgentArtifactsResult as g, TextSizeCategory as h, DeviceRotation as i, SessionSurface as k, MOBILE_PERMISSION_TARGETS as l, SettingOptions as m, ScrollExecutionOptions as n, SetFoldPoseInput as o, ReadableSetting as p, TvRemoteButton as r, BackMode as s, ScrollCommandResult as t, PermissionAction as u, CloudProviderSessionResult as v, AndroidSnapshotBackendMetadata as w, SwipePattern as x, ScrollDirection as y };