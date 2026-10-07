/**
 * Canonical operation input/output shapes.
 *
 * The executable registry remains in operations.ts. Keeping this type-only
 * graph separate lets consumers discover the public API without coupling the
 * registry's runtime parsers to every DTO in one source file.
 */
import type { SpecificOperationMap } from "./operation-map-specific.js";
import type {
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringRawOptimizationProposalResponse,
  AuthoringSessionListResponse,
  AuthoringSessionResponse,
  CommitAuthoringSessionInput,
  CreateAuthoringSessionInput,
  EditAuthoringTakeInput,
  ReorderAuthoringTakeInput,
  ReplaceAuthoringActionInput,
  TrimAuthoringTakeInput,
} from "./authoring.js";
import type { ScreenIdentityObservation } from "./app-map.js";
import type { EventEnvelope } from "./coordination.js";
import type { RecipeStep } from "./recipes.js";
import type {
  VisualBaseline,
  VisualComparison,
  VisualReviewAction,
  VisualReviewDecision,
  VisualComparisonPolicy,
  VisualRegion,
} from "./visual-verification.js";
import type {
  DevicePoolPreflight,
  InstalledBuild,
  LaunchedBuild,
  RegisteredBuildPreflight,
  TargetWorkerStatus,
} from "./target-runtime.js";
import type {
  CampaignCapacityCohortDurationEstimateRequest,
  CampaignCapacityCohortDurationEstimateResponse,
  LocalCampaignCapacityPreflight,
  LocalCampaignCapacityPreflightInput,
} from "./campaign-capacity-plan.js";
import type { IosSessionOperationLifecycle, TargetRuntimeReadiness } from "./target-contract.js";
import type { RunReview } from "./run-review.js";
import type {
  CaptureReviewAction,
  CaptureReviewDecision,
  CaptureReviewQueue,
} from "./capture-review.js";
import type { CampaignRepairOperationMap } from "./run-repair-operations.js";
import type { RunShareOperationMap } from "./run-share.js";
import type { TracePackExportResponse } from "./trace-pack.js";
import type {
  LocalCampaignAdmissionPreflightRequest,
  LocalCampaignAdmissionPreflightResponse,
} from "./combine-campaign.js";
import type { ActivityExport } from "./activity.js";
import type { AppMapOperationMap } from "./app-map-operation-map.js";
import type { OperationFamilyMap } from "./operation-family-map.js";
import type { OperationRecord, ProjectRole } from "./operation-contract.js";
import type { ExecutionTargetRef } from "./execution-target.js";
import type { TargetObservation } from "./target-observation.js";
import type { TargetSupervisorHealth } from "./target-supervisor.js";
import type { WorkflowOperationMap } from "./workflow-record.js";
import type { WorkspaceChangeContext } from "./workspace-change-context.js";
import type { ProofOperationMap } from "./proof-operation-map.js";
import type { AndroidAvdBootResult, AndroidAvdInventory } from "./target-contract.js";
export type { AndroidAvdBootResult, AndroidAvdInventory } from "./target-contract.js";

export type RedactionPolicyDto = {
  enabled: boolean;
  source: "default" | "workspace" | "environment";
  locked: boolean;
  updatedAt?: number;
};

export type SensitiveEvidenceChannelDto =
  | "audio"
  | "crash"
  | "network-body"
  | "network-raw"
  | "browser-trace";

export type EvidenceCollectionPolicyDto = {
  schemaVersion: 1;
  sensitive: Partial<
    Record<SensitiveEvidenceChannelDto, { grantedAt: number; grantedBy: string; reason: string }>
  >;
  redaction?: RedactionPolicyDto;
  updatedAt?: number;
};

/** Immutable proof returned only when a local target recovery explicitly
 * releases a process-boundary durable worker fence. */
export type DurableRecoveryFenceReleaseDto = {
  assignmentId: string;
  releasedAt: number;
  reproofId: string;
  evidence: {
    manifest: AuthoringEvidence;
    screenshotBefore: AuthoringEvidence;
    semanticSnapshot: AuthoringEvidence;
    screenshotAfter: AuthoringEvidence;
  };
};

export type JobSummaryDto = {
  id: string;
  action: string;
  status: string;
  queuedAt: number;
  frameCount: number;
  /** Durable continuation identity, when the job was started through a workflow. */
  workflowId?: string;
  workflowRequestId?: string;
  review?: RunReview;
  [key: string]: unknown;
};

export type RunSummaryDto = JobSummaryDto & {
  captureSummary?: import("./capture-review.js").CaptureReviewSummary;
  writtenAt: number;
  artifactCount: number;
  artifactBytes: number;
  storageBytes: number;
  pinned: boolean;
  retentionClass: "standard" | "protected";
};

export type RevisionedDto<T> = {
  revision: number;
  value: T;
  updatedAt: number;
  updatedBy?: string;
};

export type RevisionWriteDto<T> = {
  expectedRevision: number;
  value: T;
  actorId?: string;
  idempotencyKey?: string;
};

export type TestDataDto = {
  id: string;
  name: string;
  scope: "shared" | "private";
  source: "static" | "list" | "generated";
  fallback?: string;
  prompt?: string;
  values?: string[];
  sensitive?: boolean;
};

export type GenerationRequestDto = {
  purpose: "variable" | "test-plan";
  prompt: string;
  provider?: string;
  model?: string;
  count?: number;
  seed?: number;
  allowedValues?: string[];
};

export type GenerationResultDto = {
  provider: string;
  model: string;
  values: string[];
  generatedAt: number;
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
    costUsd?: number | undefined;
  };
  provenance?: {
    requestId: string;
    purpose: "variable" | "test-plan";
    promptDigest: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    seed?: number;
    usage?: GenerationResultDto["usage"];
  };
};

/** The exact-once diagnostic returned when a physical iOS command may already
 * have reached XCTest. It is a terminal review state, never retry metadata. */
export type IosMutationAttemptDiagnosticDto = {
  sequence: number;
  operation: string;
  nativeAttempts: 1;
  outcome: "completed" | "selector-miss" | "outcome-unknown";
  retry: {
    attempts: 0;
    decision: "not-needed" | "safe-selector-fallback" | "blocked";
    reason:
      | "native-command-completed"
      | "selector-was-not-dispatched"
      | "native-command-outcome-unknown";
  };
  intervention: {
    required: boolean;
    action: "none" | "capture-current-screen-before-any-retry";
  };
  /**
   * Cancellation arrived after Relay began its one native attempt. This remains
   * review-needed evidence, never permission to retry the command.
   */
  cancellation?: {
    observedAfterAttemptStarted: true;
  };
  at: number;
};

export type StandaloneStepReview = {
  /** Explicit observation action to take before any retry or repair. */
  captureCurrent: {
    operationId: "target.screenshot.capture";
    input: { serial: string };
  };
};

export type StepRunResult =
  | { ok: true; durationMs: number; logs: string[] }
  | { ok: false; error: string; durationMs: number; logs: string[] }
  | {
      ok: false;
      terminal: "review-needed";
      error: string;
      durationMs: number;
      logs: string[];
      code: "IOS_MUTATION_OUTCOME_UNKNOWN";
      iosMutation: IosMutationAttemptDiagnosticDto;
      iosSessionLifecycle?: IosSessionOperationLifecycle;
      /** Immutable visual proof, when the native path was able to retain it. */
      iosVisualVerification?: OperationRecord;
      stepReview: StandaloneStepReview;
    };

export type ProjectDto = {
  id: string;
  organizationId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type BuildDto = {
  id: string;
  projectId: string;
  name: string;
  platform: "android" | "ios" | "web";
  sourceUrl?: string;
  sourceSha256?: string;
  sourceSha?: string;
  configuration?: string;
  environmentRevision?: string;
  applicationId?: string;
  deploymentDigest?: string;
  webDeploymentMode?: "provider-verified" | "self-managed";
  webProviderReceipt?: import("./index.js").WebBuildProviderReceipt;
  status: "uploaded" | "ready" | "failed" | "archived";
  createdAt: number;
  updatedAt: number;
};

export type DevicePoolDto = {
  id: string;
  projectId: string;
  name: string;
  platform: "android" | "ios" | "mixed";
  deviceSerials: string[];
  createdAt: number;
  updatedAt: number;
};

export type ScrollSurveyNodeDto = {
  label?: string;
  value?: string;
  /** Android content-desc when the tree preserves it separately from text. */
  description?: string;
  identifier?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  visibleToUser?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  ref?: string;
  index?: number;
  depth?: number;
  parentIndex?: number;
  bundleId?: string;
};

/** A normalized accessibility node from a single target observation. */
export type TargetSnapshotNodeDto = ScrollSurveyNodeDto;

/** The complete semantic observation returned by `target.snapshot.capture`. */
export type TargetSnapshotDto = {
  serial?: string;
  capturedAt: number;
  nodes: TargetSnapshotNodeDto[];
  interactive: TargetSnapshotNodeDto[];
  tree: string;
  bounds?: { width: number; height: number };
  inspectable: boolean;
  source: "sdk" | "android-system" | "pixels-only";
  androidTreeBackend?: "helper" | "dump";
  inspectionState?: "active" | "keyguard" | "asleep" | "unavailable" | "unknown";
  foregroundApp?: string;
  app?: string;
  header?: string;
  treeApp?: string;
  bindingState?: "matched" | "rebound" | "unavailable";
  inspectionError?: string;
  iosSessionLifecycle?: IosSessionOperationLifecycle;
  screenIdentity: ScreenIdentityObservation;
  visualFingerprint?: string;
  proposedRows?: Array<{ x: number; y: number; top?: number; bottom?: number; height?: number }>;
  readiness?: TargetRuntimeReadiness;
};

/** The in-band raster returned by `target.screenshot.capture`. */
export type TargetScreenshotDto = {
  serial?: string;
  capturedAt: number;
  mime: "image/png";
  base64: string;
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  foregroundApp?: string;
  screenMatch?: {
    fingerprint: string;
    visualFingerprint?: string;
    matchedScreenId: string | null;
    status: "observed" | "unavailable";
  };
  proposedRows?: Array<{ x: number; y: number; top?: number; bottom?: number; height?: number }>;
  jobId?: string;
  framePath?: string;
  inspectable?: boolean;
  readiness?: TargetRuntimeReadiness;
};

export type ScrollSurveySnapshotDto = {
  serial?: string;
  capturedAt: number;
  nodes: ScrollSurveyNodeDto[];
  interactive: ScrollSurveyNodeDto[];
  bounds?: { width: number; height: number };
  inspectable: boolean;
  source: "sdk" | "android-system" | "pixels-only";
  inspectionState?: "active" | "keyguard" | "asleep" | "unavailable" | "unknown";
  foregroundApp?: string;
  treeApp?: string;
  bindingState?: "matched" | "rebound" | "unavailable";
  inspectionError?: string;
  screenIdentity: ScreenIdentityObservation;
  visualFingerprint?: string;
  proposedRows?: Array<{ x: number; y: number; top?: number; bottom?: number; height?: number }>;
};

export type ScrollSurveyStopReasonDto =
  | "end-of-content"
  | "screen-changed"
  | "inspection-unavailable"
  | "missing-page-anchor"
  | "seam-ambiguous"
  | "dimension-changed"
  | "scroll-failed"
  | "restore-failed"
  | "start-viewport-unproven"
  | "extent-unproven"
  | "limit-reached";

export type DeviceLeaseDto = {
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

export type DeviceSummary = {
  id: string;
  serial: string;
  name: string;
  kind: string | null;
  booted: boolean | null;
  platform: "android" | "ios" | "browser";
  connectionState?: string;
  osVersion?: string;
  /** Recent full native capture coordinates, never scaled preview dimensions. */
  viewport?: { width: number; height: number };
  avdName?: string;
  /** Physical Apple targets expose these when CoreDevice can inspect them. */
  developerMode?: "enabled" | "disabled";
  developerServicesAvailable?: boolean;
  /**
   * Live facts for this exact target. Static adapter capabilities never imply
   * that an iPad has a working XCTest accessibility session.
   */
  readiness?: TargetRuntimeReadiness;
};

export type ActionSummary = {
  id: string;
  title: string;
  description: string;
  category: string;
  requiresProdMatch?: boolean;
  isAlpha?: boolean;
  glyphs?: string[];
  planned?: Array<{ title: string; glyphs: string[] }>;
};

export type HealthSummary = {
  ok: boolean;
  product: string;
  version: string;
  mode: string;
  at: number;
  uptimeMs: number;
  activeJob: OperationRecord | null;
  jobs: number;
  deviceCount: number | null;
  sseClients: number;
  runsDir: string;
  access?: {
    role: ProjectRole;
    organizationId: string;
    projectId: string;
  };
};

export type RelayOperationMap = SpecificOperationMap & OperationFamilyMap;
export type OperationId = keyof RelayOperationMap;
export type OperationInput<Id extends OperationId> = RelayOperationMap[Id]["input"];
export type OperationOutput<Id extends OperationId> = RelayOperationMap[Id]["output"];
