export * from "./recipes.js";
export * from "./operations.js";
export * from "./coordination.js";
export * from "./activity.js";
export * from "./authoring.js";
export * from "./collaboration.js";
export * from "./app-map.js";
export { summarizeAppMapOperationResult } from "./app-map-summary.js";
export type { DegradedAppMapRef } from "./app-map-operation-map.js";
export * from "./scroll-surface.js";
export * from "./screen-consolidation.js";
export * from "./test-intent.js";
export * from "./case-expansion.js";
export * from "./execution-summary.js";
export * from "./run-review.js";
export * from "./campaign-repair.js";
export * from "./combine-campaign.js";
export * from "./navigation-proof.js";
export * from "./graph-exploration.js";
export * from "./run-share.js";
export * from "./visual-verification.js";
export * from "./target-runtime.js";
export * from "./target-summary.js";
export * from "./target-contract.js";
export * from "./discovery-contract.js";
export * from "./corpus-contract.js";
export * from "./locale-pack-contract.js";
export * from "./app-map-canvas.js";
export * from "./ios-mutation-terminality-contract.js";
import type { ResourceEventPayload } from "./coordination.js";
import type { ServerConnection, TargetProfile, TargetSelector } from "./target-contract.js";
export type { RunReview } from "./run-review.js";

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
    /** Durable App Map owning the saved matrix. */
    appMapId?: string;
    /** Saved canvas matrix that produced this case. Lets live/result surfaces
     * reconnect execution to its authoring object without exposing raw inputs. */
    combineId?: string;
    world: string;
    values: Record<string, string>;
    expectedScreenshots?: number;
  };
  frameCount: number;
  evidenceComplete?: boolean;
  checks?: CampaignCheckSummary[];
  lastLogs?: string[];
};

export type CampaignCheckSummary = {
  id: string;
  title: string;
  status: "passed" | "failed" | "blocked";
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  error?: string;
  dependencyReason?: string;
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
  organizationId?: string;
  projectId: string;
  poolId: string;
  deviceSerial: string;
  ownerId: string;
  /** Local trusted clients in one project may join a server-owned control session. */
  controlScope?: "actor" | "local-project";
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
