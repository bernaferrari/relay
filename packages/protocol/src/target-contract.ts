import type { ActorKind } from "./coordination.js";
import type {
  BrowserCaseProfile,
  BrowserEnvironmentInput,
  BrowserViewport,
} from "./browser-case-profile.js";

export type ConnectionAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "service-token"; token: string };

export type ServerConnection = {
  url: string;
  auth: ConnectionAuth;
  organizationId: string;
  projectId: string;
  actorId: string;
  actorKind: ActorKind;
};

export type TargetKind = "android" | "ios" | "browser";

/**
 * Static adapter capabilities answer "can this class of target support this
 * operation?" Runtime readiness answers the much narrower and more useful
 * question: "has Relay proved that this exact target can do it right now?"
 *
 * Keep these separate. An attached iPad can produce pixels through go-ios
 * while its XCTest accessibility session is unavailable; advertising `tap`
 * from the platform capability list as live control in that state caused the
 * old false-ready behaviour.
 */
export type TargetRuntimeCapabilityState = "unproven" | "proven" | "unavailable";

/** Product-safe reason codes. Native/Xcode diagnostics stay on the operation
 * that produced them rather than leaking into device discovery. */
export type TargetRuntimeCapabilityReason =
  | "not-yet-proven"
  | "target-stopped"
  | "developer-mode-disabled"
  | "developer-services-unavailable"
  | "probe-failed"
  /** A bounded iOS tree-read wait expired while the native traversal continues. */
  | "probe-in-flight"
  | "input-changed"
  | "visual-changed";

/** The independently-proven channel represented by one readiness fact. */
export type TargetRuntimeCapabilityMode = "pixels" | "accessibility" | "evidence";

/** A bounded, safe record of the last successful operation for one channel. */
export type TargetRuntimeCapabilityProof = {
  at: number;
  /** Present for accessibility probes; a non-zero count still does not bless every selector. */
  observedNodeCount?: number;
  /** End-to-end operation time, so slow targets are visible instead of guessed. */
  durationMs?: number;
};

/** Product-safe failure context. Detailed native diagnostics stay on the
 * operation response that produced them. */
export type TargetRuntimeCapabilityError = {
  at: number;
  reason: TargetRuntimeCapabilityReason;
  observedNodeCount?: number;
  durationMs?: number;
  /** Bounded, product-safe explanation from the operation that failed. */
  message?: string;
};

/** A newer input or pixel frame invalidated an earlier semantic proof. */
export type TargetRuntimeCapabilityInvalidation = {
  at: number;
  reason: "input-changed" | "visual-changed";
};

/** `proven` describes a real observation; freshness says whether its overlay
 * still belongs on the currently-previewed frame. */
export type TargetRuntimeCapabilityFreshness = "current" | "stale" | "unproven";

export type TargetRuntimeCapabilityReadiness = {
  mode: TargetRuntimeCapabilityMode;
  state: TargetRuntimeCapabilityState;
  freshness: TargetRuntimeCapabilityFreshness;
  /** Present only after this exact path completed successfully. */
  proof?: TargetRuntimeCapabilityProof;
  /** Present after a completed probe failed, or while a bounded iOS probe is
   * still running; never a raw host/Xcode error. */
  lastError?: TargetRuntimeCapabilityError;
  /** Present when a later input or changed pixel frame superseded `proof`. */
  invalidated?: TargetRuntimeCapabilityInvalidation;
  /** Static or unproven explanation when no live failure exists. */
  reason?: TargetRuntimeCapabilityReason;
  /**
   * Earliest recommended automatic retry after a completed transient probe failure.
   * This is a cooldown, not a polling instruction: callers should prefer an
   * explicit user action or a meaningful device event over background retries.
   * It is intentionally absent for static blockers such as disabled Developer
   * Mode and for `probe-in-flight`, because a second traversal would compete
   * with the native query that is still running.
   */
  nextProbeAt?: number;
};

/**
 * Current, per-target facts. `previewPixels` and `evidenceCapture` deliberately
 * remain useful when `semanticControl` is unavailable, so humans and agents
 * can still inspect and repair a device without pretending labels are usable.
 *
 * A semantic overlay or label-driven action is usable now only when
 * `semanticControl.state === "proven"` **and**
 * `semanticControl.freshness === "current"`. The two fields deliberately
 * stay separate: a prior proof is valuable evidence after input, but it is
 * not safe geometry for the newest preview frame.
 */
export type TargetRuntimeReadiness = {
  /** A current screenshot/pixel-preview path has been observed. */
  previewPixels: TargetRuntimeCapabilityReadiness;
  /** A current named accessibility surface has been observed. */
  semanticControl: TargetRuntimeCapabilityReadiness;
  /** A current visual or semantic evidence capture path has been observed. */
  evidenceCapture: TargetRuntimeCapabilityReadiness;
};

/** A bounded, product-safe record of one local XCTest-facing operation. It
 * distinguishes a runner that is unavailable from a slow, uncancellable
 * accessibility traversal that remains in flight. */
export type IosSessionOperationLifecycle = {
  operation: "preview" | "snapshot" | "screenshot" | "interaction" | "evidence";
  outcome: "passed" | "unavailable" | "in-flight";
  code:
    | "IOS_SESSION_OPERATION_READY"
    | "IOS_SESSION_OPERATION_UNAVAILABLE"
    | "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT";
  attempts: 1;
  repairAttempted: false;
  durationMs: number;
  stages: Array<{
    stage: "preview" | "xctest-availability" | "accessibility-query" | "repair";
    outcome: "passed" | "failed" | "skipped" | "in-flight";
  }>;
};

export type TargetCapability =
  | "snapshot"
  | "screenshot"
  | "stream"
  | "recording"
  | "tap"
  | "type"
  | "scroll"
  | "clipboard"
  | "network"
  | "logs"
  | "permissions"
  | "location"
  | "rotation"
  | "lock-screen"
  | "app-switcher"
  | "install"
  | "launch";

export type TargetDefinition = {
  id: string;
  name: string;
  kind: TargetKind;
  createdAt: number;
  updatedAt: number;
  browser?: {
    startUrl: string;
    executablePath?: string;
    headless?: boolean;
    /** Host/browser defaults. A run may override these with a frozen case
     * profile without mutating the saved authoring target. */
    environment?: BrowserEnvironmentInput;
    viewport?: BrowserViewport;
    /** Ephemeral targets may be removed together with their isolated profile.
     * Authoring targets retain that profile by default. */
    profileRetention?: "retain" | "ephemeral";
  };
};

export type TargetPreflight = {
  targetId: string;
  ok: boolean;
  checkedAt: number;
  capabilities: TargetCapability[];
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "warning" | "fail";
    message: string;
  }>;
};

/** An immutable description of a real target observed at matrix expansion time. */
export type TargetProfile = {
  id: string;
  targetId: string;
  source: "device" | "browser";
  platform: "android" | "ios" | "browser";
  name: string;
  model?: string;
  /** Exact configured Android emulator identity, when the target is an AVD. */
  androidAvdName?: string;
  /** Fresh collector routing hint; excluded from the frozen evidence identity. */
  observedAndroidAvdName?: string;
  osVersion?: string;
  viewport?: { width: number; height: number };
  /** Exact managed-browser environment frozen with matrix selection. */
  browserCaseProfile?: BrowserCaseProfile;
  capabilities: TargetCapability[];
  observedAt: number;
};

/** A configured local Android emulator, distinct from attached ADB devices. */
export type AndroidAvdSummary = {
  avdName: string;
  serial?: string;
  name: string;
  platform: "android";
  kind: "emulator";
  target: "mobile" | "tv";
  booted: boolean;
  status: "stopped" | "booting" | "booted";
  source: "android-sdk";
};

export type AndroidAvdInventory = {
  source: "android-sdk" | "unavailable";
  available: boolean;
  avds: AndroidAvdSummary[];
  reason?: "sdk-unavailable" | "inventory-failed";
};

export type AndroidAvdBootResult = {
  avdName: string;
  serial: string;
  platform: "android";
  kind: "emulator";
  booted: true;
  status: "booted" | "already-booted";
  reused: boolean;
  observedAt: number;
};

/** A deliberate allow-list plus optional observed-fact constraints. */
export type TargetSelector = {
  targetIds?: string[];
  platforms?: TargetProfile["platform"][];
  osVersionPrefixes?: string[];
  nameIncludes?: string[];
  requiredCapabilities?: TargetCapability[];
};
