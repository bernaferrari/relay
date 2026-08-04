export * from "./recipes.js";
export * from "./operations.js";
export * from "./coordination.js";
export * from "./authoring.js";
export * from "./collaboration.js";
export * from "./app-map.js";
export * from "./execution-summary.js";
export * from "./visual-verification.js";
export * from "./target-runtime.js";
export * from "./target-summary.js";
import type { RecipeStep } from "./recipes.js";
import type { ActorKind, ResourceEventPayload } from "./coordination.js";

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

export type EvidenceChannel =
  | "input"
  | "screenshot"
  | "video"
  | "ui-tree"
  | "logs"
  | "network"
  | "performance"
  | "crash"
  | "audio";

export type EvidenceChannelStatus =
  | "captured"
  | "partial"
  | "unsupported"
  | "denied"
  | "failed"
  | "redacted";

export type RedactionPolicySource = "default" | "workspace" | "environment";

/** Effective policy applied before evidence is exposed or persisted. */
export type RedactionPolicy = {
  enabled: boolean;
  source: RedactionPolicySource;
  locked: boolean;
  updatedAt?: number;
};

export type SensitiveEvidenceChannel = "audio" | "crash" | "network-body";

export type EvidenceConsentGrant = {
  grantedAt: number;
  grantedBy: string;
  reason: string;
};

/** Workspace policy frozen into a run before any sensitive collector starts. */
export type EvidenceCollectionPolicy = {
  schemaVersion: 1;
  sensitive: Partial<Record<SensitiveEvidenceChannel, EvidenceConsentGrant>>;
  updatedAt?: number;
};

export type EvidenceChannelRecord = {
  channel: EvidenceChannel;
  status: EvidenceChannelStatus;
  startedAt?: number;
  finishedAt?: number;
  entries: number;
  bytes: number;
  dropped: number;
  redactions: number;
  message?: string;
};

export type EvidenceEvent = {
  sequence: number;
  at: number;
  monotonicMs: number;
  channel: EvidenceChannel;
  kind: string;
  stepId?: string;
  actionId?: string;
  artifact?: string;
  data?: unknown;
};

/** Machine-readable evidence completeness for one bounded run. */
export type EvidenceManifest = {
  schemaVersion: 1;
  runId: string;
  target: {
    kind: "device" | "browser";
    platform: "android" | "ios" | "browser";
    id?: string;
    profileId?: string;
  };
  startedAt: number;
  finishedAt?: number;
  collectionPolicy?: EvidenceCollectionPolicy;
  channels: Record<EvidenceChannel, EvidenceChannelRecord>;
  events: EvidenceEvent[];
};

export type JobSummary = {
  id: string;
  action: string;
  title?: string;
  status: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  platform?: string;
  serial?: string;
  outcome?: string;
  batchId?: string;
  frameCount: number;
  evidenceComplete?: boolean;
};

export type TraceFrameDto = {
  path: string;
  caption: string;
  capturedAt: number;
  bytes?: number;
  base64?: string;
  mime?: string;
  width?: number;
  height?: number;
};

export type TraceStepDto = {
  id: string;
  index: number;
  kind: string;
  tone: string;
  title: string;
  glyphs: string[];
  actions?: { kind: string; at: number; label?: string }[];
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  frames: TraceFrameDto[];
  log: string;
  heal?: string;
  status?: string;
};

export type RunSummary = JobSummary & {
  writtenAt: number;
  artifactCount: number;
  artifactBytes: number;
  pinned: boolean;
  retentionClass: "standard" | "protected";
};

export type EvidenceMetricStatus = "available" | "insufficient-evidence";

export type EvidenceMetric = {
  schemaVersion: 1;
  id:
    | "completion.duration"
    | "interaction.attempts"
    | "interaction.rapid-repeat-clusters"
    | "network.requests"
    | "network.failures"
    | "log.errors";
  unit: "ms" | "count";
  status: EvidenceMetricStatus;
  value?: number;
  reason?: string;
  requiredChannels: EvidenceChannel[];
  sourceSequences: number[];
  targetProfileId?: string;
  appVersion?: string;
  confidence: "high" | "medium" | "low";
};

export type RegressionSignal = {
  metric: EvidenceMetric;
  baseline?: { median: number; sampleCount: number };
  delta?: number;
  budget?: number;
  material: boolean;
  direction: "regression" | "improvement" | "neutral" | "unknown";
  reason?: string;
};

/** A stable, privacy-aware projection of the evidence collected for a run.
 *
 * Reports and agents should consume this projection instead of needing to
 * understand provider-specific artifact payloads. Raw artifacts remain
 * available through the persisted run for forensic export, but this shape is
 * the portable, bounded observability contract.
 */
export type RunEvidenceLogEntry = {
  id: string;
  at?: number;
  level: "trace" | "debug" | "info" | "warn" | "error" | "unknown";
  source?: string;
  message: string;
};

export type RunEvidenceNetworkEntry = {
  id: string;
  at?: number;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  result: "success" | "failure" | "pending" | "unknown";
  source?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyTruncated?: boolean;
};

export type RunEvidencePerformanceSample = {
  id: string;
  at?: number;
  phase: "start" | "end" | "sample" | "unknown";
  metrics: Record<string, number | string | boolean | null>;
};

export type RunEvidenceArtifactSummary = {
  kind: string;
  capturedAt: number;
  entries?: number;
  bytes?: number;
  summary?: string;
};

/** One inspectable fact placed on the run's shared replay clock. */
export type RunEvidenceEvent = {
  id: string;
  at: number;
  channel: "log" | "network" | "performance" | "crash" | "artifact";
  tone: "neutral" | "info" | "success" | "warning" | "critical";
  label: string;
  detail?: string;
  sourceId?: string;
};

export type RunEvidenceQuery = {
  schemaVersion: 1;
  runId: string;
  generatedAt: number;
  target: {
    platform?: string;
    serial?: string;
    name?: string;
    profileId?: string;
  };
  channels: Partial<Record<EvidenceChannel, EvidenceChannelRecord>>;
  logs: RunEvidenceLogEntry[];
  network: RunEvidenceNetworkEntry[];
  networkCapture: {
    mode: "browser-events" | "session-log" | "transparent-proxy" | "unavailable";
    label: string;
    detail: string;
  };
  performance: RunEvidencePerformanceSample[];
  crashes: unknown[];
  artifacts: RunEvidenceArtifactSummary[];
  events: RunEvidenceEvent[];
  limits: { requested: number; applied: number; bodiesIncluded: boolean };
  notes: string[];
};

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number`);
  return value;
}

export function parseRunSummary(value: unknown): RunSummary {
  const input = objectValue(value, "run summary");
  return {
    ...(input as RunSummary),
    id: stringValue(input.id, "run summary id"),
    action: stringValue(input.action, "run summary action"),
    status: stringValue(input.status, "run summary status"),
    queuedAt: numberValue(input.queuedAt, "run summary queuedAt"),
    writtenAt: numberValue(input.writtenAt, "run summary writtenAt"),
    frameCount: numberValue(input.frameCount, "run summary frameCount"),
    artifactCount: numberValue(input.artifactCount, "run summary artifactCount"),
    artifactBytes: numberValue(input.artifactBytes, "run summary artifactBytes"),
    pinned: Boolean(input.pinned),
    retentionClass: input.retentionClass === "protected" ? "protected" : "standard",
  };
}

export function parseJobSummary(value: unknown): JobSummary {
  const input = objectValue(value, "job summary");
  return {
    ...(input as JobSummary),
    id: stringValue(input.id, "job summary id"),
    action: stringValue(input.action, "job summary action"),
    status: stringValue(input.status, "job summary status"),
    queuedAt: numberValue(input.queuedAt, "job summary queuedAt"),
    frameCount: numberValue(input.frameCount, "job summary frameCount"),
  };
}

export type RelayEndpointMap = {
  "GET /settings/privacy": { response: { policy: RedactionPolicy } };
  "PUT /settings/privacy": {
    request: { enabled: boolean };
    response: { policy: RedactionPolicy };
  };
  "GET /settings/evidence": { response: { policy: EvidenceCollectionPolicy } };
  "PUT /settings/evidence": {
    request: { channel: SensitiveEvidenceChannel; enabled: boolean; reason?: string };
    response: { policy: EvidenceCollectionPolicy };
  };
  "GET /jobs?full=0": { response: { jobs: JobSummary[] } };
  "POST /jobs/soak": {
    request: { recipe: string; matrixId: string; repetitions?: number; prodAccountMatch?: string };
    response: {
      jobs: JobSummary[];
      matrix: MatrixExpansion;
      batchId: string;
      repetitions: number;
    };
  };
  "GET /runs": { response: { runs: RunSummary[] } };
  "GET /runs/:id/signals": {
    response: { metrics: EvidenceMetric[]; signals: RegressionSignal[]; reason?: string };
  };
  "GET /reports/soak/:batchId": { response: { report: SoakReport } };
  "POST /runs/:id/pin": { request: { pinned: boolean }; response: { ok: true; pinned: boolean } };
};

export function parseEvidenceManifest(value: unknown): EvidenceManifest {
  const input = objectValue(value, "evidence manifest");
  if (input.schemaVersion !== 1) throw new Error("unsupported evidence manifest schemaVersion");
  const channels = objectValue(input.channels, "evidence channels");
  const validStatuses: EvidenceChannelStatus[] = [
    "captured",
    "partial",
    "unsupported",
    "denied",
    "failed",
    "redacted",
  ];
  for (const name of [
    "input",
    "screenshot",
    "video",
    "ui-tree",
    "logs",
    "network",
    "performance",
    "crash",
    "audio",
  ] as EvidenceChannel[]) {
    const channel = objectValue(channels[name], `evidence channel ${name}`);
    if (!validStatuses.includes(channel.status as EvidenceChannelStatus)) {
      throw new Error(`invalid evidence status for ${name}`);
    }
  }
  if (!Array.isArray(input.events)) throw new Error("evidence events must be an array");
  return input as EvidenceManifest;
}

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
    viewport?: { width: number; height: number };
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
  osVersion?: string;
  viewport?: { width: number; height: number };
  capabilities: TargetCapability[];
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

export type CompatibilityMatrix = {
  id: string;
  projectId: string;
  name: string;
  selectors: TargetSelector[];
  createdAt: number;
  updatedAt: number;
};

export type MatrixExclusion = {
  profile: TargetProfile;
  reason: string;
};

/** Frozen selection used for a run; later device changes cannot alter it. */
export type MatrixExpansion = {
  matrixId: string;
  matrixName: string;
  resolvedAt: number;
  profiles: TargetProfile[];
  excluded: MatrixExclusion[];
};

/** A frozen, evidence-backed projection of one compatibility matrix execution. */
export type CompatibilityProfileReport = {
  profile: TargetProfile;
  runIds: string[];
  total: number;
  passed: number;
  productFailures: number;
  harnessFailures: number;
  uncertain: number;
  pending: number;
  passRate: number | null;
  medianDurationMs: number | null;
  baseline?: {
    total: number;
    passRate: number | null;
    medianDurationMs: number | null;
    passRateDelta: number | null;
    durationDeltaMs: number | null;
  };
};

export type CompatibilityReport = {
  batchId: string;
  recipeId: string;
  matrixId?: string;
  matrixName?: string;
  generatedAt: number;
  total: number;
  profiles: CompatibilityProfileReport[];
};

export type SoakEvidenceChannelReport = {
  channel: EvidenceChannel;
  expected: number;
  captured: number;
  partial: number;
  denied: number;
  unsupported: number;
  failed: number;
  missing: number;
  coverageRate: number | null;
};

/** Aggregate quality and evidence coverage for a repeated compatibility run. */
export type SoakReport = {
  schemaVersion: 1;
  batchId: string;
  recipeId: string;
  matrixId?: string;
  matrixName?: string;
  generatedAt: number;
  repetitions: number;
  total: number;
  complete: number;
  pending: number;
  passed: number;
  productFailures: number;
  harnessFailures: number;
  uncertain: number;
  targetProfiles: TargetProfile[];
  collectionPolicy?: EvidenceCollectionPolicy;
  evidence: SoakEvidenceChannelReport[];
};

export type DiscoveryScope = {
  maxScreens: number;
  maxTransitions: number;
  maxDurationMs: number;
  allowedOrigins?: string[];
  allowSensitiveControls?: boolean;
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
  snapshotDigest?: string;
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

export type DiscoveryCoverageReport = {
  mapName: string;
  generatedAt: number;
  sessionIds: string[];
  profiles: TargetProfile[];
  unprofiledSessionIds: string[];
  screens: DiscoveryCoverageItem[];
  transitions: DiscoveryCoverageItem[];
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

export type DiscoverySession = {
  id: string;
  name: string;
  targetId: string;
  targetProfile?: TargetProfile;
  agent?: DiscoveryAgentContext;
  scope: DiscoveryScope;
  status: DiscoveryStatus;
  createdAt: number;
  updatedAt: number;
  /** Last screen observed on the connected target. Older maps may omit this. */
  currentScreenId?: string;
  screens: ObservedScreen[];
  transitions: ObservedTransition[];
};

export type Revisioned<T> = {
  revision: number;
  value: T;
  updatedAt: number;
  updatedBy?: string;
};

export type RevisionWrite<T> = {
  expectedRevision: number;
  value: T;
  actorId?: string;
  idempotencyKey?: string;
};

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type Build = {
  id: string;
  projectId: string;
  name: string;
  platform: "android" | "ios";
  sourceUrl?: string;
  status: "uploaded" | "ready" | "failed" | "archived";
  createdAt: number;
  updatedAt: number;
};

export type DevicePool = {
  id: string;
  projectId: string;
  name: string;
  platform: "android" | "ios" | "mixed";
  deviceSerials: string[];
  createdAt: number;
  updatedAt: number;
};

export type DeviceLease = {
  id: string;
  projectId: string;
  poolId: string;
  deviceSerial: string;
  ownerId: string;
  status: "leased" | "released" | "expired";
  leasedAt: number;
  expiresAt: number;
  releasedAt?: number;
  /** Previous lease replaced by an explicit, audited control handoff. */
  handoffFromLeaseId?: string;
  /** Human-readable reason supplied by the actor taking control. */
  handoffReason?: string;
};

export type TestVariable = {
  id: string;
  name: string;
  /** Shared values are collaborative. Private definitions are collaborative,
   * but their values must be supplied by the actor at execution time. */
  scope: "shared" | "private";
  source: "static" | "list" | "generated";
  prompt?: string;
  values?: string[];
  fallback?: string;
  sensitive?: boolean;
};

export type CanvasPosition = { x: number; y: number };
/** Non-executable context placed beside captured screens: a compact canvas
 * primitive for requirements, review decisions, or a reminder to branch. */
export type CanvasNote = CanvasPosition & {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};
/** A non-destructive edit of the evidence video attached to a transition. */
export type RecordingClip = {
  startMs: number;
  endMs: number;
};

/** Replay is the approval loop for one connection, independent from a full
 * Flow run. A draft can be refined repeatedly without losing its evidence. */
export type ConnectionTakeReview = {
  status: "draft" | "verified" | "failed";
  updatedAt: number;
  verifiedAt?: number;
  error?: string;
  /** Verification is recorded per target so one passing phone never hides a
   * failing tablet. The aggregate status remains useful for compact UI. */
  targets?: TargetVerification[];
};

export type TargetVerification = {
  targetId: string;
  targetName?: string;
  platform?: "android" | "ios" | "browser";
  status: "passed" | "failed" | "needs-review";
  checkedAt: number;
  observedFingerprint?: string;
  runId?: string;
  error?: string;
};

/** A captured pass before (or after) it becomes part of the executable path.
 * Keeping the raw step/evidence references here lets people resume review
 * after a restart without turning exploratory actions into the App Map. */
export type ConnectionTake = {
  id: string;
  recipeId: string;
  /** Explicit source keeps a paused/reloaded review attached to the screen
   * the person actually recorded from, rather than whichever card is selected
   * when they return. */
  sourceScreenId?: string;
  sourceObservation?: ScreenObservation;
  destinationObservation?: ScreenObservation;
  startedAt: number;
  finishedAt?: number;
  group: string;
  /** Local Relay video evidence captured through the physical iOS runner. */
  videoTakeId?: string;
  videoClip?: RecordingClip;
  state: "review" | "kept" | "discarded";
  steps: RecipeStep[];
};
/** A deliberately small, human-owned decision about the executable Flow.
 * It is separate from run evidence: someone can approve the authored path
 * while still reviewing a particular run against a visual baseline. */
export type MapReviewState = "draft" | "needs-review" | "approved" | "attention";

export type MapReview = {
  state: MapReviewState;
  updatedAt: number;
  approvedAt?: number;
};
/**
 * A prototype connection belongs to the canvas, not the runner. When it has a
 * `stepId` it describes a real recorded action; when it is pending it is an
 * intentional, visible reminder to record that interaction. This keeps the
 * graph honest while still letting someone sketch a route before recording it.
 */
export type PrototypeConnection = {
  id: string;
  fromScreenId: string;
  toScreenId: string;
  stepId?: string;
  /** Capture provenance remains attached to the canonical connection. */
  takeId?: string;
  videoTakeId?: string;
  videoClip?: RecordingClip;
  label?: string;
  state: "recorded" | "needs-recording";
  createdAt: number;
  updatedAt: number;
};

/**
 * Canvas projection of the canonical App Map. The projection is separate
 * from the executable recipe: it describes the screens a person sees and the
 * transitions they approve between those screens. The runner still receives a
 * plain ordered RecipeStep[] compiled from the transition step ids.
 *
 * This separation is what lets the canvas become collaborative and free-form
 * without making a partially-arranged diagram change what runs on a device.
 */
export type CanvasScreen = {
  id: string;
  title: string;
  /** Canonical semantic identity. Optional until evidence establishes it. */
  identity?: ScreenIdentity;
  /** Concrete captures known to represent this screen. */
  observations?: ScreenObservation[];
  /** The post-action capture used to render this card, when one exists. */
  representativeStepId?: string;
  createdAt: number;
  updatedAt: number;
};

export type CanvasDestination = { kind: "screen"; screenId: string } | { kind: "end" };

export type CanvasTransition = {
  id: string;
  fromScreenId: string;
  destination: CanvasDestination;
  /** Stable recipe action ids, in the exact order a person recorded them. */
  stepIds: string[];
  /** Immutable evidence committed in the same aggregate as this connection. */
  evidenceIds?: string[];
  /** The full take is evidence for the edge, not merely for either endpoint.
   * A video may contain loading, animation, or navigation that no single
   * discrete action can describe. */
  takeId?: string;
  videoTakeId?: string;
  videoClip?: RecordingClip;
  /** How the transition was authored. All modes still compile to recipe steps. */
  mode?: "interaction" | "automatic" | "reusable";
  review?: ConnectionTakeReview;
  /** Where this edge came from. This makes repeated discovery imports
   * idempotent and keeps generated maps auditable without coupling execution
   * to a discovery session. */
  provenance?: {
    source: "recording" | "discovery" | "manual";
    externalId?: string;
    sessionId?: string;
  };
  label?: string;
  state: "recorded" | "needs-recording";
  kind: "forward" | "return";
  createdAt: number;
  updatedAt: number;
};

/** An App Map can expose more than one intentional Flow entry point. */
export type CanvasFlow = {
  id: string;
  name: string;
  screenId: string;
  /** Canonical App Map Routine executed before checking this entry screen. */
  setup?: { routineId: string; bindings?: Record<string, string> };
  /** Optional named target set. The same canonical route is replayed against
   * every profile in the set; device-specific forks remain exceptional. */
  targetSetId?: string;
  createdAt: number;
  updatedAt: number;
};

export type CanvasGraph = {
  schemaVersion: 1;
  screens: CanvasScreen[];
  transitions: CanvasTransition[];
  flows: CanvasFlow[];
};

/** A named device context for an App Map. Variant-specific captures can be
 * attached later without changing the authored route or its executable steps. */
export type DeviceVariant = {
  id: string;
  label: string;
  deviceId?: string;
  status: "current" | "verified" | "needs-review";
  updatedAt: number;
};

export type MapVerification = {
  state: "draft" | "verifying" | "needs-review" | "baselined";
  updatedAt: number;
  baselineAt?: number;
  baselineRunId?: string;
};

/** Canvas-only prototype data, projected from canonical App Map entities. */
export type ConnectionPrototype = {
  connections?: PrototypeConnection[];
  deviceVariants?: DeviceVariant[];
  verification?: MapVerification;
};
/**
 * Layout metadata is deliberately separate from a recipe's executable steps.
 * It lets the graph evolve and be rearranged without changing executable actions.
 */
export type AppMapCanvasState = {
  schemaVersion: 1;
  positions: Record<string, CanvasPosition>;
  /** Optional visual organization projected from canonical Map Groups. */
  groups?: import("./app-map.js").MapGroup[];
  /** Human names for captured screens. Kept outside executable steps so the
   * graph can be clarified without changing what a runner performs. */
  screenTitles?: Record<string, string>;
  edgeLabels: Record<string, string>;
  edgeKinds: Record<string, string>;
  notes?: CanvasNote[];
  /** Versioned, non-executable recording review state. */
  takes?: ConnectionTake[];
  /** Human approval of the map; run-by-run visual approval stays in run evidence. */
  review?: MapReview;
  /** Canvas-only authoring, device coverage, and baseline state. */
  prototype?: ConnectionPrototype;
  /** Renderer projection of canonical App Map screens, connections, and flows. */
  graph?: CanvasGraph;
};

export type GenerationPurpose = "variable" | "test-plan";
export type GenerationRequest = {
  purpose: GenerationPurpose;
  prompt: string;
  provider?: string;
  model?: string;
  count?: number;
  seed?: number;
  /** Optional closed output vocabulary. Providers may reason over untrusted
   * app content, but Relay accepts only one of these exact values. */
  allowedValues?: string[];
};
export type GenerationUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  costUsd?: number | undefined;
};
export type GenerationProvenance = {
  requestId: string;
  purpose: GenerationPurpose;
  promptDigest: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  seed?: number;
  usage?: GenerationUsage | undefined;
};
export type GenerationResult = {
  provider: string;
  model: string;
  values: string[];
  generatedAt: number;
  usage?: GenerationUsage | undefined;
  provenance?: GenerationProvenance | undefined;
};

export type RunCaseProvenance = {
  variableId: string;
  variableName: string;
  source: TestVariable["source"];
  provider?: string;
  model?: string;
  generatedAt?: number;
  seed?: number;
};

export type FrozenRunCase = {
  id: string;
  name: string;
  index: number;
  values: Record<string, string>;
  provenance: RunCaseProvenance[];
};

export type RunOutcome =
  | "passed"
  | "product-failure"
  | "harness-failure"
  | "uncertain"
  | "cancelled";

export type FailureCategory =
  | "environment"
  | "target-state"
  | "locator"
  | "action"
  | "completion"
  | "extraction"
  | "deterministic-assertion"
  | "semantic-assertion"
  | "visual-assertion"
  | "judge-uncertainty"
  | "harness-defect";

export type ConversationContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; code: string; language?: string }
  | { type: "image"; artifactId: string }
  | { type: "citation"; label: string; destination?: string }
  | { type: "file"; name: string; artifactId?: string }
  | { type: "status"; state: string };

export type ExtractedConversationTurn = {
  role: "user" | "assistant" | "system";
  capturedAt: number;
  blocks: ConversationContentBlock[];
  source: "accessibility" | "clipboard" | "vision" | "ocr";
};

export type EvaluationCriterionResult = {
  id: string;
  description: string;
  passed: boolean;
  score: number;
  evidence?: string;
};

export type SemanticEvaluationRequest = {
  input: string;
  criteria: string[];
  threshold?: number;
  provider?: string;
  model?: string;
};

export type SemanticEvaluationResult = {
  status: "pass" | "fail" | "uncertain";
  confidence: number;
  score: number;
  summary: string;
  criteria: EvaluationCriterionResult[];
  provider: string;
  model: string;
  evaluatedAt: number;
};

export type ResourceEvent = ResourceEventPayload;

export class RevisionConflict<T = unknown> extends Error {
  readonly status = 409;
  constructor(readonly current: Revisioned<T>) {
    super(`Revision conflict: current revision is ${current.revision}`);
    this.name = "RevisionConflict";
  }
}

export function normalizeConnection(connection: ServerConnection): ServerConnection {
  if (!connection.actorId.trim()) throw new TypeError("Server connection actorId is required");
  return {
    ...connection,
    url: connection.url.replace(/\/+$/, ""),
    organizationId: connection.organizationId.trim() || "local",
    projectId: connection.projectId.trim() || "default",
    actorId: connection.actorId.trim(),
  };
}
