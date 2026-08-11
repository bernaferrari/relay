export * from "./recipes.js";
export * from "./operations.js";
export * from "./coordination.js";
export * from "./activity.js";
export * from "./authoring.js";
export * from "./collaboration.js";
export * from "./app-map.js";
export * from "./case-expansion.js";
export * from "./execution-summary.js";
export * from "./run-review.js";
export * from "./run-share.js";
export * from "./visual-verification.js";
export * from "./target-runtime.js";
export * from "./target-summary.js";
import type { RecipeStep } from "./recipes.js";
import type { ActorKind, ResourceEventPayload } from "./coordination.js";
export type { RunReview } from "./run-review.js";

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
  review?: import("./run-review.js").RunReview;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  /** Safe, redacted matrix identity used by live progress UIs and CLI output.
   * Raw/private run inputs remain execution-only. */
  matrixCase?: {
    kind: "combine";
    /** Saved canvas matrix that produced this case. Lets live/result surfaces
     * reconnect execution to its authoring object without exposing raw inputs. */
    combineId?: string;
    world: string;
    values: Record<string, string>;
    expectedScreenshots?: number;
  };
  frameCount: number;
  evidenceComplete?: boolean;
  lastLogs?: string[];
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
  screens: ObservedScreen[];
  transitions: ObservedTransition[];
};

/** Bounds for a first-class settings / i18n tree corpus. */
export type CorpusScope = {
  /** Maximum navigation depth from the corpus root (0 = root only). */
  maxDepth: number;
  maxScreens: number;
  maxTransitions: number;
  maxDurationMs: number;
  /** Locales to capture. First is the map locale unless mapLocale is set. */
  locales: string[];
  /**
   * map-once-replay (default): DFS the tree once in the map locale, then switch
   * language and replay the same path plan for every other locale.
   * crawl-each: independent DFS per locale (legacy).
   */
  strategy?: "map-once-replay" | "crawl-each";
  /** Locale used to discover the tree. Defaults to locales[0]. */
  mapLocale?: string;
  /** App to open / relaunch between locale passes (bundle id or name). */
  app?: string;
  /** Optional path from the current screen to the corpus root (e.g. open Settings). */
  entryPath?: CorpusNavStep[];
  /**
   * Path from the corpus root to the in-app language picker. Used before each
   * non-map locale so the next language can be chosen.
   */
  languagePath?: CorpusNavStep[];
  /**
   * Per-locale selection steps inside the language picker. Keys are locale tags
   * from `locales` (e.g. "pt-BR"). Prefer accessibility identifiers over labels.
   */
  languageOptions?: Record<string, CorpusNavStep[]>;
  /**
   * Explicit stateful journeys recorded once in the map locale. Capture steps
   * preserve dialogs, toggles, sheets, and scrolled viewports that a page-only
   * crawl cannot infer safely.
   */
  journeys?: CorpusJourney[];
  allowSensitiveControls?: boolean;
};

export type CorpusStatus = "draft" | "running" | "paused" | "complete" | "stopped" | "failed";

export type CorpusNavStep =
  | {
      kind: "tap";
      target: {
        stableKey?: string;
        identifier?: string;
        label?: string;
        text?: string;
        point?: { x: number; y: number };
      };
    }
  | { kind: "back" }
  | { kind: "wait"; ms: number }
  | { kind: "scroll"; direction: "up" | "down"; amount?: number }
  | { kind: "relaunch" }
  /** Open/switch foreground app without requiring relaunch (deep-link handoff). */
  | { kind: "openApp"; app: string; relaunch?: boolean };

export type CorpusJourneyStep =
  | CorpusNavStep
  | {
      kind: "capture";
      /** Human-readable evidence name, e.g. “Birth Year dialog”. */
      name: string;
      /** Locale-independent identity. Defaults to a slug of name. */
      key?: string;
    };

export type CorpusJourney = {
  id: string;
  name: string;
  /** Starts from app + entryPath; may contain multiple capture checkpoints. */
  steps: CorpusJourneyStep[];
};

export type CorpusControl = {
  id: string;
  label: string;
  /** Locale-stable control key when identifiers or LocalizedStringKey exist. */
  stableKey: string;
  role?: string;
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  };
};

/** One concrete screen observation inside a corpus, always bound to a locale. */
export type CorpusScreen = {
  id: string;
  /** Locale-stable structural identity shared across language passes. */
  canonicalKey: string;
  /** Full semantic fingerprint for this locale's copy. */
  fingerprint: string;
  locale: string;
  depth: number;
  /** Slash-joined path labels from the corpus root (localized). */
  path: string[];
  /** Stable path keys when available (identifiers / string keys). */
  pathKeys: string[];
  title?: string;
  capturedAt: number;
  screenshotPath?: string;
  /** Relative pack path written at export time, e.g. pt-BR/settings/app-language.png */
  artifactPath?: string;
  snapshotDigest?: string;
  /** Raw normalized accessibility snapshot captured beside the screenshot. */
  accessibilityPath?: string;
  accessibilityDigest?: string;
  controls?: CorpusControl[];
  /** Localized labels observed on this screen, keyed by stable control key. */
  localizedLabels?: Record<string, string>;
};

export type CorpusTransition = {
  id: string;
  fromScreenId: string;
  toScreenId?: string;
  locale: string;
  kind: "tap" | "scroll" | "back" | "relaunch" | "manual";
  label?: string;
  stableKey?: string;
  target?: CorpusControl["target"];
  depth: number;
  capturedAt: number;
  changedScreen: boolean;
};

/** One step recorded while mapping the tree in the map locale. */
export type CorpusMapAction =
  | {
      kind: "open";
      stableKey: string;
      label: string;
      target: CorpusControl["target"];
      depth: number;
      /** Stable path keys after this open (root → … → this control). */
      pathKeys: string[];
      /** Localized path labels from the map locale (display only). */
      path: string[];
      fromCanonicalKey: string;
      toCanonicalKey?: string;
    }
  | {
      kind: "back";
      depth: number;
      fromCanonicalKey: string;
    };

/** Deterministic tree plan produced by the map-locale DFS, replayed per locale. */
export type CorpusMapPlan = {
  mappedLocale: string;
  rootCanonicalKey?: string;
  /** Preorder open/back actions from the map crawl. */
  actions: CorpusMapAction[];
  mappedAt: number;
};

export type CorpusProgress = {
  phase:
    | "idle"
    | "opening"
    | "mapping"
    | "switching-language"
    | "replaying"
    | "crawling"
    | "exporting"
    | "complete"
    | "failed";
  locale?: string;
  depth?: number;
  path?: string[];
  screensCaptured: number;
  transitionsCaptured: number;
  /** Values whose complete mapped screen set has been captured. */
  completedLocales?: string[];
  message?: string;
  updatedAt: number;
};

export type CorpusPackManifest = {
  schemaVersion: 2;
  sessionId: string;
  name: string;
  generatedAt: number;
  locales: string[];
  rootDir: string;
  execution: {
    projectId?: string;
    organizationId?: string;
    status: CorpusStatus;
    createdAt: number;
    updatedAt: number;
    targetId: string;
    targetProfile?: TargetProfile;
    strategy: CorpusScope["strategy"];
    mapLocale: string;
    app?: string;
    completedLocales: string[];
    mapPlan?: CorpusMapPlan;
  };
  screens: Array<{
    id: string;
    locale: string;
    canonicalKey: string;
    depth: number;
    path: string[];
    pathKeys: string[];
    title?: string;
    file: string;
    sha256: string;
    accessibilityFile?: string;
    accessibilitySha256?: string;
  }>;
  /** canonicalKey → locale → relative PNG path for side-by-side compare */
  byCanonicalKey: Record<string, Record<string, string>>;
  /** Deterministic findings derived from the same frozen screenshots and UI trees. */
  analysis: CorpusAnalysisReport;
};

export type CorpusSession = {
  id: string;
  name: string;
  projectId?: string;
  organizationId?: string;
  targetId: string;
  targetProfile?: TargetProfile;
  scope: CorpusScope;
  status: CorpusStatus;
  createdAt: number;
  updatedAt: number;
  currentScreenId?: string;
  currentLocale?: string;
  progress: CorpusProgress;
  screens: CorpusScreen[];
  transitions: CorpusTransition[];
  /** Tree discovered in the map locale; replayed for every other language. */
  mapPlan?: CorpusMapPlan;
  /** Relative directory under .relay/corpus/<id>/pack when exported. */
  packRoot?: string;
  error?: string;
};

export type CorpusCoverageItem = {
  id: string;
  label: string;
  canonicalKey: string;
  observedLocales: string[];
  missingLocales: string[];
  screenIds: string[];
};

export type CorpusCoverageReport = {
  sessionId: string;
  name: string;
  generatedAt: number;
  locales: string[];
  screens: CorpusCoverageItem[];
  complete: number;
  partial: number;
  missing: number;
};

export type CorpusFindingCode =
  | "SCREEN_MISSING"
  | "POSSIBLE_LOCALE_NOT_APPLIED"
  | "CONTROL_MISSING"
  | "POSSIBLE_UNTRANSLATED_TEXT";

export type CorpusFinding = {
  id: string;
  code: CorpusFindingCode;
  severity: "critical" | "warning";
  confidence: "high" | "medium";
  canonicalKey: string;
  screenLabel: string;
  locale: string;
  baselineLocale: string;
  stableKey?: string;
  expected?: string;
  observed?: string;
  detail: string;
};

/** A bounded, explainable localization review. This intentionally reports
 * possible translation defects instead of pretending deterministic heuristics
 * can prove linguistic correctness. */
export type CorpusAnalysisReport = {
  schemaVersion: 1;
  sessionId: string;
  generatedAt: number;
  baselineLocale: string;
  findings: CorpusFinding[];
  critical: number;
  warnings: number;
  affectedScreens: number;
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

export type TestData = {
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

/** A recorded interaction location projected into a screen preview. Values
 * are normalized to the captured viewport so the same evidence survives
 * responsive cards, zoom, and different canvas layouts. */
export type CanvasInteractionAnchor = {
  point: CanvasPosition;
  rect?: { x: number; y: number; width: number; height: number };
};
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
  /** The first recorded interaction target, when the take captured one. */
  sourceAnchor?: CanvasInteractionAnchor;
  /** Where this edge came from. This makes repeated discovery imports
   * idempotent and keeps generated maps auditable without coupling execution
   * to a discovery session. */
  provenance?: {
    source: "recording" | "discovery" | "manual";
    externalId?: string;
    sessionId?: string;
  };
  label?: string;
  /** Durable canvas-only connector styling. It does not alter the actions the
   * runner executes. */
  presentation?: import("./app-map.js").ConnectionPresentation;
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
  source: TestData["source"];
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
  | "review-required"
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
