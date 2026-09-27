import type { TargetProfile } from "./target-contract.js";
import type { NavigationProofCursorArtifact } from "./navigation-proof.js";
import type { StateFixture } from "./exploration-policy.js";

/** Explore crawl strategies (local-first here/do/ground loop). */
export type DiscoveryExploreStrategy = "surface" | "timeline" | "hard-edges";

export type DiscoveryExploreStopCode = "complete" | "cancelled" | "budget" | "left_app" | "error";

export type DiscoveryExploreStopReason = {
  code: DiscoveryExploreStopCode;
  message: string;
  at: number;
};

/** A safe row Explore could not execute without guessing. */
export type DiscoveryExploreProblem = {
  screenId: string;
  controlId: string;
  label: string;
  reason: string;
  capturedAt: number;
};

/**
 * Durable work position for a server-owned Explore crawl.
 *
 * This is intentionally a small, reviewable frontier rather than a serialized
 * device snapshot. The navigation proof below remains the authority for the
 * target's actual location; this cursor only says which safe candidates are
 * still pending after the last proven action.
 */
export type DiscoveryExploreCursor = {
  schemaVersion: 1;
  stack: Array<{
    screenId: string;
    pendingControlIds: string[];
  }>;
  exploredEdgeKeys: string[];
  sameScreenActions: Record<string, number>;
  /** Set before dispatch and cleared only after a fresh post-action observe. */
  inFlight?: {
    screenId: string;
    controlId: string;
  };
};

export type DiscoveryExploreFixtureState = {
  definition: StateFixture;
  phase: "preparing" | "prepared" | "verified" | "cleanup-pending" | "cleaned";
};

/**
 * What one server-owned explore crawl chose and how it ended.
 *
 * Persisted on the session so a `tsx watch` reload — or any other process
 * restart — does not silently turn a finished crawl back into an unknown one.
 */
export type DiscoveryExploreRun = {
  strategy: DiscoveryExploreStrategy;
  maxDepth: number;
  /** Unresolved rows are durable Problems, never silently skipped work. */
  problems?: DiscoveryExploreProblem[];
  stopReason?: DiscoveryExploreStopReason;
  /**
   * The only runtime truth about where Explore has actually proved the device is.
   * Planner visits and the session's last observed screen are not navigation proof.
   */
  navigationCursor?: NavigationProofCursorArtifact;
  /** Persisted frontier used to resume without repeating a completed action. */
  cursor?: DiscoveryExploreCursor;
  /** Optional reviewed state fixture; secret material is never embedded. */
  fixture?: DiscoveryExploreFixtureState;
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

/**
 * Viewport rectangle omitted from screen-identity matching.
 * Not a capture-review mask and not a visual-baseline exclusion unless a
 * VisualComparisonPolicy region says so. Unit rectangles (every edge ≤ 1)
 * are fractions of the observed frame; larger values are pixels of that
 * same frame.
 */
export type ScreenIdentityIgnoreRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
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
  /** Authored dynamic regions (reply body, gallery) for identity matching.
   * Host packs already drop leftover chats; geometric ignore must not punch
   * remaining chrome. Visual compare uses VisualComparisonPolicy, not these. */
  ignoreRegions?: ScreenIdentityIgnoreRegion[];
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

/** One step on the ordered discovery exploration timeline. */
export type DiscoveryExplorationTimelineStep = {
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

export type DiscoveryExplorationTimeline = {
  sessionId: string;
  mapName: string;
  generatedAt: number;
  status: DiscoveryStatus;
  stepCount: number;
  steps: DiscoveryExplorationTimelineStep[];
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
  /** Ordered path for the anchor session. */
  explorationTimeline?: DiscoveryExplorationTimeline;
  /** Why explore stopped short when evidence exists on the anchor session. */
  blockedReasons?: DiscoveryBlockedReason[];
  /** Explore completion for the anchor session. */
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

/** Bounds for a first-class settings / i18n exploration tree. */
