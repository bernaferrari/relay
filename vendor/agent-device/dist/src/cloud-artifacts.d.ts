import { A as SnapshotNode, M as SnapshotQualityVerdict, N as SnapshotState, O as ScreenshotOverlayRef, U as PublicPlatform, n as DaemonArtifactType } from "./sdk-contracts.js";
//#region packages/contracts/src/back-mode.d.ts
declare const BACK_MODES: readonly ['in-app', 'system'];
type BackMode = (typeof BACK_MODES)[number];
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
};
type FindLocator = 'any' | 'text' | 'label' | 'value' | 'role' | 'id';
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
export { BackendSnapshotResult as a, SnapshotDiagnosticsSummary as c, DeviceRotation as d, BackMode as f, AndroidSnapshotBackendMetadata as i, SessionSurface as l, CloudArtifactProvider as n, FindLocator as o, CloudProviderSessionResult as r, ScreenshotResultData as s, AgentArtifactsResult as t, TvRemoteButton as u };