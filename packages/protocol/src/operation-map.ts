/**
 * Canonical operation input/output shapes.
 *
 * The executable registry remains in operations.ts. Keeping this type-only
 * graph separate lets consumers discover the public API without coupling the
 * registry's runtime parsers to every DTO in one source file.
 */
import type {
  AuthoringInteraction,
  AuthoringSessionListResponse,
  AuthoringSessionResponse,
  CommitAuthoringSessionInput,
  CreateAuthoringSessionInput,
  ReorderAuthoringTakeInput,
  ReplaceAuthoringActionInput,
  TrimAuthoringTakeInput,
} from "./authoring.js";
import type { ScreenIdentityObservation } from "./app-map.js";
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
  LocalCampaignCapacityPreflight,
  LocalCampaignCapacityPreflightInput,
} from "./campaign-capacity-plan.js";
import type { IosSessionOperationLifecycle, TargetRuntimeReadiness } from "./target-contract.js";
import type { RunReview } from "./run-review.js";
import type { CampaignRepairOperationMap } from "./run-repair-operations.js";
import type { RunShareOperationMap } from "./run-share.js";
import type { ActivityExport } from "./activity.js";
import type { AppMapOperationMap } from "./app-map-operation-map.js";
import type { CorpusOperationId } from "./corpus-operation-definitions.js";
import type { CombineOperationId } from "./combine-operation-definitions.js";
import type { OperationRecord, ProjectRole } from "./operation-contract.js";

export type RedactionPolicyDto = {
  enabled: boolean;
  source: "default" | "workspace" | "environment";
  locked: boolean;
  updatedAt?: number;
};

export type SensitiveEvidenceChannelDto = "audio" | "crash" | "network-body";

export type EvidenceCollectionPolicyDto = {
  schemaVersion: 1;
  sensitive: Partial<
    Record<SensitiveEvidenceChannelDto, { grantedAt: number; grantedBy: string; reason: string }>
  >;
  updatedAt?: number;
};

export type JobSummaryDto = {
  id: string;
  action: string;
  status: string;
  queuedAt: number;
  frameCount: number;
  review?: RunReview;
  [key: string]: unknown;
};

export type RunSummaryDto = JobSummaryDto & {
  writtenAt: number;
  artifactCount: number;
  artifactBytes: number;
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
  platform: "android" | "ios";
  sourceUrl?: string;
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

type SpecificOperationMap = {
  "system.health.get": { input: Record<string, never>; output: HealthSummary };
  "event.stream": { input: Record<string, never>; output: OperationRecord };
  "activity.export": {
    input: Record<string, never>;
    output: { export: ActivityExport };
  };
  "workspace.privacy.get": {
    input: Record<string, never>;
    output: { policy: RedactionPolicyDto };
  };
  "workspace.privacy.update": {
    input: { enabled: boolean };
    output: { policy: RedactionPolicyDto };
  };
  "workspace.evidence.get": {
    input: Record<string, never>;
    output: { policy: EvidenceCollectionPolicyDto };
  };
  "workspace.evidence.update": {
    input: { channel: SensitiveEvidenceChannelDto; enabled: boolean; reason?: string };
    output: { policy: EvidenceCollectionPolicyDto };
  };
  "target.actions.list": { input: Record<string, never>; output: { actions: ActionSummary[] } };
  "target.devices.list": { input: Record<string, never>; output: { devices: DeviceSummary[] } };
  "target.snapshot.capture": {
    input: { serial: string; visual?: boolean };
    output: {
      nodes: unknown[];
      interactive: unknown[];
      tree: string;
      readiness?: TargetRuntimeReadiness;
      iosSessionLifecycle?: IosSessionOperationLifecycle;
    };
  };
  "target.screenshot.capture": {
    input: { serial: string; previewX?: number; previewY?: number };
    output: {
      path: string;
      bytes: number;
      base64?: string;
      mime?: string;
      serial?: string;
      capturedAt?: number;
      width?: number;
      height?: number;
      screenMatch?: {
        fingerprint: string;
        visualFingerprint?: string;
        matchedScreenId: string | null;
        status: "observed" | "unavailable";
      };
      proposedRows?: Array<{
        x: number;
        y: number;
        top?: number;
        bottom?: number;
        height?: number;
      }>;
      readiness?: TargetRuntimeReadiness;
    };
  };
  "step.run": { input: OperationRecord; output: StepRunResult };
  "target.scroll-survey.capture": {
    input: { serial: string; maxScrolls?: number };
    output: {
      status: "completed" | "stopped";
      reason: ScrollSurveyStopReasonDto;
      frames: Array<{
        index: number;
        offsetY: number;
        screenshot: {
          base64: string;
          width: number;
          height: number;
          capturedAt: number;
        };
        snapshot: ScrollSurveySnapshotDto;
        appendedHeight: number;
      }>;
      diagnosticFrames: Array<{
        index: number;
        offsetY: number;
        screenshot: {
          base64: string;
          width: number;
          height: number;
          capturedAt: number;
        };
        snapshot: ScrollSurveySnapshotDto;
        appendedHeight: number;
      }>;
      stitched?: {
        base64: string;
        width: number;
        height: number;
        mime: "image/png";
      };
      mergedNodes: ScrollSurveyNodeDto[];
      restoredStartViewport: boolean;
      message: string;
    };
  };
  "target.app.launch": {
    input: { serial: string; app: string; relaunch?: boolean };
    output: {
      launched: {
        serial: string;
        app: string;
        platform: "android" | "ios";
        launchedAt: number;
      };
    };
  };
  "target.app.locales": {
    input: { serial: string; package: string };
    output: { packageName: string; locales: string[] };
  };
  "target.ui.describe": {
    input: { serial: string };
    output: {
      summary: string;
      platform?: string;
      serial?: string;
      foregroundApp?: string;
      titles: string[];
      sheetLikely: boolean;
      keyboardLikely: boolean;
      topLabels: string[];
      coordinateSpace: "logical-points";
      bounds?: { width: number; height: number };
      nodeCount: number;
      treePreview: string;
    };
  };
  "target.ui.back": {
    input: { serial: string; parentTitles?: string[] };
    output: { method: "back" | "parent" | "close" | "key" | "edge-swipe" };
  };
  "target.ui.scrollCollect": {
    input: { serial: string; maxScrolls?: number; allowSensitive?: boolean };
    output: {
      controls: Array<{
        label: string;
        role?: string;
        target: { identifier?: string; ref?: string; label?: string; text?: string };
      }>;
      count: number;
    };
  };
  "target.recover": {
    input: {
      serial: string;
      reason?: "connect" | "observe" | "control" | "record" | "auto";
    };
    output: {
      recovery: {
        serial: string;
        recovered: boolean;
        ready: boolean;
        summary: string;
        actions: Array<{
          kind: "stale-lock" | "agent-device" | "core-device";
          status: "completed" | "skipped" | "failed";
          detail: string;
        }>;
        session: {
          status: "restored" | "unavailable";
          app?: string;
          fallback?: boolean;
          detail: string;
        };
        readiness?: TargetRuntimeReadiness;
      };
    };
  };
  "job.list": {
    input: { limit?: number };
    output: { jobs: JobSummaryDto[]; active?: JobSummaryDto | null };
  };
  "job.get": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.start": {
    input: { recipe: string; serial?: string; [key: string]: unknown };
    output: { job: OperationRecord };
  };
  "run.replay": { input: { runId: string }; output: { job: OperationRecord } };
  "job.cancel": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.pause": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.resume": { input: { jobId: string }; output: { job: OperationRecord } };
  "run.list": { input: { limit?: number; appMapId?: string }; output: { runs: RunSummaryDto[] } };
  "run.get": { input: { runId: string }; output: { run: OperationRecord } };
  "run.replay.offline": {
    input: { runId: string };
    output: { report: OperationRecord };
  };
  "run.review": {
    input: { runId: string; action: "approve" | "reject"; note?: string };
    output: { run: OperationRecord; review: RunReview };
  };
  "run.evidence.get": {
    input: { runId: string; limit?: number; includeBodies?: boolean };
    output: { evidence: OperationRecord };
  };
  "run.story.get": { input: { runId: string }; output: { story: OperationRecord } };
  "run.visual.compare": { input: { runId: string }; output: { comparison: VisualComparison } };
  "run.visual.review": {
    input: { runId: string; comparisonId: string; action: VisualReviewAction; note?: string };
    output: { decision: VisualReviewDecision; baseline: VisualBaseline | null };
  };
  "run.visual-policy.get": {
    input: { runId: string };
    output: { policy: VisualComparisonPolicy };
  };
  "run.visual-policy.update": {
    input: {
      runId: string;
      expectedRevision: number;
      changeThreshold: number;
      pixelThreshold: number;
      regions: VisualRegion[];
    };
    output: { policy: VisualComparisonPolicy; comparison: VisualComparison };
  };
  "run.visual-baseline.update": {
    input: { runId: string; action: "approve-new-baseline"; note?: string };
    output: {
      comparison: VisualComparison;
      decision: VisualReviewDecision;
      baseline: VisualBaseline;
    };
  };
  "workspace.variables.get": {
    input: Record<string, never>;
    output: RevisionedDto<TestDataDto[]>;
  };
  "workspace.variables.update": {
    input: RevisionWriteDto<TestDataDto[]>;
    output: RevisionedDto<TestDataDto[]>;
  };
  "authoring.session.list": {
    input: {
      appMapId?: string;
      targetId?: string;
      activeOnly?: boolean;
    };
    output: AuthoringSessionListResponse;
  };
  "authoring.session.get": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.session.create": {
    input: CreateAuthoringSessionInput;
    output: AuthoringSessionResponse;
  };
  "authoring.session.begin": {
    input: CreateAuthoringSessionInput;
    output: AuthoringSessionResponse;
  };
  "authoring.session.observe": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.session.capture": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.session.start": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.session.interact": {
    input: { sessionId: string; interaction: AuthoringInteraction };
    output: AuthoringSessionResponse;
  };
  "authoring.session.stop": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.take.trim": {
    input: TrimAuthoringTakeInput;
    output: AuthoringSessionResponse;
  };
  "authoring.take.reorder": {
    input: ReorderAuthoringTakeInput;
    output: AuthoringSessionResponse;
  };
  "authoring.take.replace": {
    input: ReplaceAuthoringActionInput;
    output: AuthoringSessionResponse;
  };
  "authoring.take.replay": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.session.commit": {
    input: CommitAuthoringSessionInput;
    output: AuthoringSessionResponse;
  };
  "authoring.session.discard": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.session.cancel": {
    input: { sessionId: string };
    output: AuthoringSessionResponse;
  };
  "authoring.session.cleanup": {
    input: { sessionId: string };
    output: { ok: true };
  };
  "generation.create": { input: GenerationRequestDto; output: GenerationResultDto };
  "project.list": { input: Record<string, never>; output: { projects: ProjectDto[] } };
  "project.save": {
    input: Pick<ProjectDto, "id" | "name">;
    output: { project: ProjectDto };
  };
  "build.list": { input: Record<string, never>; output: { builds: BuildDto[] } };
  "build.save": {
    input: Omit<BuildDto, "projectId" | "createdAt" | "updatedAt">;
    output: { build: BuildDto };
  };
  "build.preflight": {
    input: { buildId: string; serial?: string };
    output: { preflight: RegisteredBuildPreflight };
  };
  "build.install": {
    input: { buildId: string; serial: string; launch?: boolean; applicationId?: string };
    output: { installed: InstalledBuild; launched?: LaunchedBuild };
  };
  "build.launch": {
    input: { buildId: string; serial: string; applicationId?: string };
    output: { launched: LaunchedBuild };
  };
  "device-pool.list": { input: Record<string, never>; output: { pools: DevicePoolDto[] } };
  "device-pool.save": {
    input: Omit<DevicePoolDto, "projectId" | "createdAt" | "updatedAt">;
    output: { pool: DevicePoolDto };
  };
  "device-pool.preflight": {
    input: { poolId: string };
    output: { preflight: DevicePoolPreflight };
  };
  "target-worker.list": {
    input: Record<string, never>;
    output: { workers: TargetWorkerStatus[] };
  };
  "campaign.capacity.preflight": {
    input: LocalCampaignCapacityPreflightInput;
    output: { preflight: LocalCampaignCapacityPreflight };
  };
  "lease.list": {
    input: { status?: "active" | "all" };
    output: { leases: DeviceLeaseDto[] };
  };
  "lease.create": {
    input: Pick<DeviceLeaseDto, "poolId" | "deviceSerial"> &
      Partial<Pick<DeviceLeaseDto, "expiresAt">>;
    output: { lease: DeviceLeaseDto };
  };
  "lease.takeover": {
    input: {
      leaseId: string;
      expiresAt?: number;
      reason: string;
      confirm: true;
    };
    output: { lease: DeviceLeaseDto };
  };
  "lease.release": { input: { leaseId: string }; output: { lease: DeviceLeaseDto } };
} & AppMapOperationMap &
  CampaignRepairOperationMap &
  RunShareOperationMap;

type GenericOperationId =
  | "system.doctor.get"
  | "system.audit.list"
  | "activity.list"
  | "workspace.apple-device.update"
  | "target.list"
  | "target.create"
  | "target.delete"
  | "target.preflight"
  | "target.open"
  | "target.boot"
  | "target.authorize"
  | "target.interact"
  | "target.ground"
  | "target.do"
  | "target.ui.describe"
  | "target.ui.back"
  | "target.ui.scrollCollect"
  | "target.touch"
  | "target.key"
  | "target.scroll"
  | "target.video.start"
  | "target.stream.open"
  | "action.run"
  | "recipe.list"
  | "recipe.get"
  | "recipe.create"
  | "recipe.update"
  | "recipe.delete"
  | "recipe.yaml.get"
  | "recipe.import"
  | "recipe.evidence.create"
  | "recipe.history.list"
  | "recipe.history.restore"
  | "recipe.stability.get"
  | "schedule.list"
  | "schedule.create"
  | "schedule.delete"
  | "matrix.list"
  | "matrix.create"
  | "matrix.update"
  | "matrix.delete"
  | "matrix.import"
  | "matrix.resolve"
  | "presence.list"
  | "presence.upsert"
  | "presence.clear"
  | "discovery.list"
  | "discovery.create"
  | "discovery.get"
  | "discovery.rename"
  | "discovery.status.update"
  | "discovery.capture"
  | "discovery.interact"
  | "discovery.here"
  | "discovery.do"
  | "discovery.suggestion"
  | "discovery.coverage"
  | "discovery.journey"
  | "discovery.export"
  | "discovery.promote"
  | "discovery.start"
  | "discovery.cancel"
  | CorpusOperationId
  | "job.locale-matrix.start"
  | "job.locale-matrix.export"
  | "job.locale-matrix.analysis"
  | "job.locale-matrix.infer"
  | CombineOperationId
  | "job.retry"
  | "run.replay"
  | "job.active.cancel"
  | "job.matrix.start"
  | "job.compatibility-matrix.start"
  | "job.soak.start"
  | "run.catalog.rebuild"
  | "run.retention.apply"
  | "run.pin.update";

type GenericOperationMap = {
  [Id in GenericOperationId]: { input: OperationRecord; output: OperationRecord };
};

export type RelayOperationMap = SpecificOperationMap & GenericOperationMap;
export type OperationId = keyof RelayOperationMap;
export type OperationInput<Id extends OperationId> = RelayOperationMap[Id]["input"];
export type OperationOutput<Id extends OperationId> = RelayOperationMap[Id]["output"];
