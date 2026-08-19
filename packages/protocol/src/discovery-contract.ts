import type { TargetProfile } from "./target-contract.js";

/** -shaped explore crawl strategies (local-first here/do/ground loop). */
export type DiscoveryExploreStrategy = "surface" | "journey" | "hard-edges";

/** How the explorer picks the next option: semantic heuristics, or a stub model planner. */
export type DiscoveryExploreMode = "semantic" | "model";

export type DiscoveryExploreStopCode = "complete" | "cancelled" | "budget" | "left_app" | "error";

export type DiscoveryExploreStopReason = {
  code: DiscoveryExploreStopCode;
  message: string;
  at: number;
};

/**
 * What one server-owned explore crawl chose and how it ended.
 *
 * Persisted on the session so a `tsx watch` reload — or any other process
 * restart — does not silently turn a finished crawl back into an unknown one.
 */
export type DiscoveryExploreRun = {
  strategy: DiscoveryExploreStrategy;
  mode: DiscoveryExploreMode;
  maxDepth: number;
  stopReason?: DiscoveryExploreStopReason;
  softRecoveries: number;
  startedAt: number;
  updatedAt: number;
};

export type DiscoveryScope = {
  maxScreens: number;
  maxTransitions: number;
  maxDurationMs: number;
  allowedOrigins?: string[];
  allowSensitiveControls?: boolean;
  /** Explore strategy when discovery.start runs the server-owned crawl. */
  strategy?: DiscoveryExploreStrategy;
  /** Option picker mode for explore (model stays stub/heuristic until a real planner lands). */
  mode?: DiscoveryExploreMode;
  /** Max navigation depth from the seed screen; strategy supplies a default when omitted. */
  maxDepth?: number;
};

export type DiscoveryStatus = "draft" | "running" | "paused" | "complete" | "stopped";

export type DiscoveryAgentContext = {
  workerId: string;
  appMapId: string;
  goal: string;
  focus?: string;
  provider: string;
  model?: string;
  buildId?: string;
  caseStackId?: string;
  source: "ui" | "cli" | "mcp" | "api";
  createdBy?: { actorId: string; actorKind: "human" | "agent" | "system" };
};

export type DiscoveryDecisionProvenance = {
  mode: "model" | "semantic";
  provider: string;
  model: string;
  selectedControlId: string;
  requestId?: string;
  promptDigest?: string;
  durationMs?: number;
};

/** Stable, explainable identity for one semantic application screen. Pixels
 * are observations of this identity, not the identity itself: clocks,
 * counters, animation, and device dimensions may change between captures. */
export type ScreenIdentity = {
  schemaVersion: 1;
  fingerprint: string;
  /** Additional fingerprints that a person or a high-confidence matcher has
   * approved as the same screen. */
  aliases?: string[];
};

/** One concrete observation of a semantic screen. A node can accumulate many
 * observations across recordings, discovery sessions, devices, and runs. */
export type ScreenObservation = {
  id: string;
  fingerprint: string;
  capturedAt: number;
  source: "recording" | "discovery" | "run" | "manual";
  externalId?: string;
  sessionId?: string;
  deviceId?: string;
  platform?: "android" | "ios" | "browser";
  snapshotDigest?: string;
  representativeStepId?: string;
};

export type ObservedScreen = {
  id: string;
  fingerprint: string;
  identity?: ScreenIdentity;
  title?: string;
  capturedAt: number;
  screenshotPath?: string;
  /** Raw normalized accessibility snapshot captured beside the screenshot. */
  accessibilityPath?: string;
  snapshotDigest?: string;
  accessibilityDigest?: string;
  variantOf?: string;
  controls?: DiscoveryControl[];
};

export type DiscoveryControl = {
  id: string;
  label: string;
  role?: string;
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  };
};

/** Cross-profile coverage for an intentionally shared Discovery Map name. */
export type DiscoveryCoverageItem = {
  id: string;
  label: string;
  observedProfileIds: string[];
  missingProfileIds: string[];
  sessionIds: string[];
};

export type ObservedTransition = {
  id: string;
  fromScreenId: string;
  toScreenId?: string;
  kind: "tap" | "type" | "scroll" | "back" | "manual";
  label?: string;
  target?: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  };
  text?: string;
  direction?: "up" | "down";
  capturedAt: number;
  changedScreen: boolean;
  decision?: DiscoveryDecisionProvenance;
};

/** One step on the ordered discovery path timeline (Atlas journey). */
export type DiscoveryJourneyStep = {
  index: number;
  transitionId: string;
  kind: ObservedTransition["kind"];
  label?: string;
  fromScreenId: string;
  toScreenId?: string;
  fromTitle?: string;
  toTitle?: string;
  changedScreen: boolean;
  capturedAt: number;
  /** Relative screenshot path on the destination (or source if unchanged). */
  screenshotPath?: string;
  /** HTTP asset path when served: /discovery/:sessionId/screens/:screenId */
  screenshotScreenId?: string;
};

export type DiscoveryJourney = {
  sessionId: string;
  mapName: string;
  generatedAt: number;
  status: DiscoveryStatus;
  stepCount: number;
  steps: DiscoveryJourneyStep[];
};

export type DiscoveryBlockedReason = {
  code: "left-app" | "auth" | "budget" | "cancelled" | "incomplete" | "error";
  message: string;
  evidence?: string;
};

export type DiscoveryExploreOutcome = "complete" | "partial" | "blocked" | "running" | "draft";

export type DiscoveryCoverageReport = {
  mapName: string;
  generatedAt: number;
  sessionIds: string[];
  profiles: TargetProfile[];
  unprofiledSessionIds: string[];
  screens: DiscoveryCoverageItem[];
  transitions: DiscoveryCoverageItem[];
  /** Ordered path for the anchor session (Atlas journey timeline). */
  journey?: DiscoveryJourney;
  /** Why explore stopped short when evidence exists on the anchor session. */
  blockedReasons?: DiscoveryBlockedReason[];
  /** -shaped explore completion for the anchor session. */
  exploreOutcome?: DiscoveryExploreOutcome;
};

export type DiscoverySession = {
  id: string;
  name: string;
  /** Owning project. Older maps may omit this and are treated as "default". */
  projectId?: string;
  organizationId?: string;
  targetId: string;
  targetProfile?: TargetProfile;
  agent?: DiscoveryAgentContext;
  scope: DiscoveryScope;
  status: DiscoveryStatus;
  createdAt: number;
  updatedAt: number;
  /** Last screen observed on the connected target. Older maps may omit this. */
  currentScreenId?: string;
  /** Last explore crawl on this session. Absent when only humans have driven it. */
  explore?: DiscoveryExploreRun;
  screens: ObservedScreen[];
  transitions: ObservedTransition[];
};

/** Bounds for a first-class settings / i18n tree corpus. */
