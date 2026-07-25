export * from "./suites.js";
export * from "./recipes.js";
import type { RecipeStep } from "./recipes.js";

export type ConnectionAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "service-token"; token: string };

export type ServerConnection = {
  url: string;
  auth: ConnectionAuth;
  organizationId: string;
  projectId: string;
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
  | "app-switcher";

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

export type ObservedScreen = {
  id: string;
  fingerprint: string;
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
  target: { ref?: string; label?: string; text?: string; point?: { x: number; y: number } };
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
  target?: { ref?: string; label?: string; text?: string; point?: { x: number; y: number } };
  text?: string;
  direction?: "up" | "down";
  capturedAt: number;
  changedScreen: boolean;
};

export type DiscoverySession = {
  id: string;
  name: string;
  targetId: string;
  targetProfile?: TargetProfile;
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
};

export type TestVariable = {
  id: string;
  name: string;
  source: "static" | "list" | "generated";
  prompt?: string;
  values?: string[];
  fallback: string;
  sensitive?: boolean;
};

export type JourneyNodePosition = { x: number; y: number };
/** Non-executable context placed beside captured screens: a compact canvas
 * primitive for requirements, review decisions, or a reminder to branch. */
export type JourneyCanvasNote = JourneyNodePosition & {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};
/** A captured pass before (or after) it becomes part of the executable path.
 * Keeping the raw step/evidence references here lets people resume review
 * after a restart without turning exploratory actions into the journey. */
export type JourneyTake = {
  id: string;
  recipeId: string;
  startedAt: number;
  finishedAt?: number;
  group: string;
  state: "review" | "kept" | "discarded";
  steps: RecipeStep[];
};
/**
 * Layout metadata is deliberately separate from a recipe's executable steps.
 * It lets the graph evolve (and be rearranged) without making a recorded
 * journey impossible to run on an older Relay host.
 */
export type JourneyMetadata = {
  schemaVersion?: 1 | 2 | 3;
  positions: Record<string, JourneyNodePosition>;
  edgeLabels: Record<string, string>;
  edgeKinds: Record<string, string>;
  notes?: JourneyCanvasNote[];
  /** Versioned, non-executable recording review state. */
  takes?: JourneyTake[];
};

export type GenerationPurpose = "variable" | "test-plan";
export type GenerationRequest = {
  purpose: GenerationPurpose;
  prompt: string;
  provider?: string;
  model?: string;
  count?: number;
  seed?: number;
};
export type GenerationResult = {
  provider: string;
  model: string;
  values: string[];
  generatedAt: number;
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

export type ResourceEvent = {
  type: "resource.created" | "resource.updated" | "resource.deleted" | "lease.changed";
  at: number;
  projectId: string;
  resource: "project" | "build" | "device-pool" | "lease" | "variables" | "journey" | "matrix";
  resourceId: string;
  revision?: number;
};

export class RevisionConflict<T = unknown> extends Error {
  readonly status = 409;
  constructor(readonly current: Revisioned<T>) {
    super(`Revision conflict: current revision is ${current.revision}`);
    this.name = "RevisionConflict";
  }
}

export function normalizeConnection(connection: ServerConnection): ServerConnection {
  return {
    ...connection,
    url: connection.url.replace(/\/+$/, ""),
    organizationId: connection.organizationId.trim() || "local",
    projectId: connection.projectId.trim() || "default",
  };
}
