// Keep operations at the bottom of the protocol graph. Do not import `index.ts`.
import {
  assertAuthoringSessionRef,
  parseAuthoringSessionListResponse,
  parseAuthoringSessionResponse,
  type AuthoringInteraction,
  type AuthoringSessionListResponse,
  type AuthoringSessionResponse,
  type CommitAuthoringSessionInput,
  type CreateAuthoringSessionInput,
  type ReorderAuthoringTakeInput,
  type ReplaceAuthoringActionInput,
  type TrimAuthoringTakeInput,
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
import type { IosSessionOperationLifecycle, TargetRuntimeReadiness } from "./target-contract.js";
import { assertIosSessionOperationLifecycle } from "./ios-session-lifecycle.js";
import type { RunReview } from "./run-review.js";
import {
  runRepairOperationDefinitions,
  type CampaignRepairOperationMap,
} from "./run-repair-operations.js";
import { runShareOperationDefinitions, type RunShareOperationMap } from "./run-share.js";
import { parseActivityExportResponse, type ActivityExport } from "./activity.js";
import { createAppMapOperationDefinitions } from "./app-map-operation-definitions.js";
import {
  createCorpusOperationDefinitions,
  type CorpusOperationId,
} from "./corpus-operation-definitions.js";
import { createDiscoveryOperationDefinitions } from "./discovery-operation-definitions.js";
import {
  combineOperationDefinitions,
  type CombineOperationId,
} from "./combine-operation-definitions.js";
import { createOperationBuilders } from "./operation-builders.js";
import type { AppMapOperationMap } from "./app-map-operation-map.js";
import {
  projectRoles,
  type OperationDefinition,
  type OperationRecord,
  type ProjectRole,
  type RuntimeParser,
} from "./operation-contract.js";
import {
  arrayFieldParser,
  boolean,
  emptyInputParser,
  fail,
  number,
  objectFieldParser,
  objectParser,
  operationRecordParser,
  record,
  string,
} from "./operation-parser-primitives.js";
export { operationRecordParser } from "./operation-parser-primitives.js";
export {
  projectRoleAllows,
  projectRoles,
  type OperationCategory,
  type OperationConfirmation,
  type OperationDefinition,
  type OperationIdempotency,
  type OperationMode,
  type OperationRecord,
  type OperationTransport,
  type ProjectRole,
  type RuntimeParser,
} from "./operation-contract.js";
type RedactionPolicyDto = {
  enabled: boolean;
  source: "default" | "workspace" | "environment";
  locked: boolean;
  updatedAt?: number;
};
type SensitiveEvidenceChannelDto = "audio" | "crash" | "network-body";
type EvidenceCollectionPolicyDto = {
  schemaVersion: 1;
  sensitive: Partial<
    Record<SensitiveEvidenceChannelDto, { grantedAt: number; grantedBy: string; reason: string }>
  >;
  updatedAt?: number;
};
type JobSummaryDto = {
  id: string;
  action: string;
  status: string;
  queuedAt: number;
  frameCount: number;
  review?: RunReview;
  [key: string]: unknown;
};
type RunSummaryDto = JobSummaryDto & {
  writtenAt: number;
  artifactCount: number;
  artifactBytes: number;
  pinned: boolean;
  retentionClass: "standard" | "protected";
};
type RevisionedDto<T> = {
  revision: number;
  value: T;
  updatedAt: number;
  updatedBy?: string;
};

type RevisionWriteDto<T> = {
  expectedRevision: number;
  value: T;
  actorId?: string;
  idempotencyKey?: string;
};

type TestDataDto = {
  id: string;
  name: string;
  scope: "shared" | "private";
  source: "static" | "list" | "generated";
  fallback?: string;
  prompt?: string;
  values?: string[];
  sensitive?: boolean;
};

type GenerationRequestDto = {
  purpose: "variable" | "test-plan";
  prompt: string;
  provider?: string;
  model?: string;
  count?: number;
  seed?: number;
  allowedValues?: string[];
};

type GenerationResultDto = {
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

type ProjectDto = {
  id: string;
  organizationId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

type BuildDto = {
  id: string;
  projectId: string;
  name: string;
  platform: "android" | "ios";
  sourceUrl?: string;
  status: "uploaded" | "ready" | "failed" | "archived";
  createdAt: number;
  updatedAt: number;
};

type DevicePoolDto = {
  id: string;
  projectId: string;
  name: string;
  platform: "android" | "ios" | "mixed";
  deviceSerials: string[];
  createdAt: number;
  updatedAt: number;
};

type ScrollSurveyNodeDto = {
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

type ScrollSurveySnapshotDto = {
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

type ScrollSurveyStopReasonDto =
  | "end-of-content"
  | "screen-changed"
  | "inspection-unavailable"
  | "missing-page-anchor"
  | "seam-ambiguous"
  | "dimension-changed"
  | "scroll-failed"
  | "restore-failed"
  | "limit-reached";

type DeviceLeaseDto = {
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

const okParser = objectParser<{ ok: true }>("success response", (input) => {
  if (input.ok !== true) fail("success response ok", "must be true");
});

const healthParser = objectParser<HealthSummary>("health response", (input) => {
  boolean(input.ok, "health ok");
  string(input.product, "health product");
  string(input.version, "health version");
  number(input.at, "health at");
  number(input.uptimeMs, "health uptimeMs");
  if (input.access !== undefined) {
    const access = record(input.access, "health access");
    if (!projectRoles.includes(access.role as ProjectRole)) {
      fail("health access role", "must be viewer, author, runner, or admin");
    }
    string(access.organizationId, "health access organizationId");
    string(access.projectId, "health access projectId");
  }
});

const activityExportParser: RuntimeParser<{ export: ActivityExport }> = {
  description: "project activity export",
  parse: parseActivityExportResponse,
};

const targetRuntimeCapabilityStates = new Set(["unproven", "proven", "unavailable"]);
const targetRuntimeCapabilityModes = new Set(["pixels", "accessibility", "evidence"]);
const targetRuntimeCapabilityFreshness = new Set(["current", "stale", "unproven"]);
const targetRuntimeCapabilityModeByKey = {
  previewPixels: "pixels",
  semanticControl: "accessibility",
  evidenceCapture: "evidence",
} as const;
const targetRuntimeCapabilityReasons = new Set([
  "not-yet-proven",
  "target-stopped",
  "developer-mode-disabled",
  "developer-services-unavailable",
  "probe-failed",
  "probe-in-flight",
  "input-changed",
  "visual-changed",
]);

function assertTargetRuntimeReadiness(value: unknown, label: string): void {
  const readiness = record(value, label);
  for (const capability of Object.keys(targetRuntimeCapabilityModeByKey) as Array<
    keyof typeof targetRuntimeCapabilityModeByKey
  >) {
    const state = record(readiness[capability], `${label} ${capability}`);
    if (!targetRuntimeCapabilityModes.has(String(state.mode))) {
      fail(`${label} ${capability} mode`, "must be pixels, accessibility, or evidence");
    }
    if (state.mode !== targetRuntimeCapabilityModeByKey[capability]) {
      fail(
        `${label} ${capability} mode`,
        `must be ${targetRuntimeCapabilityModeByKey[capability]}`,
      );
    }
    if (!targetRuntimeCapabilityStates.has(String(state.state))) {
      fail(`${label} ${capability} state`, "must be unproven, proven, or unavailable");
    }
    if (!targetRuntimeCapabilityFreshness.has(String(state.freshness))) {
      fail(`${label} ${capability} freshness`, "must be current, stale, or unproven");
    }
    const proven = state.state === "proven";
    if (proven && state.freshness === "unproven") {
      fail(`${label} ${capability} freshness`, "cannot be unproven after a successful proof");
    }
    if (!proven && state.freshness !== "unproven") {
      fail(`${label} ${capability} freshness`, "must be unproven without a successful proof");
    }
    if (proven && state.proof === undefined) {
      fail(`${label} ${capability} proof`, "is required when state is proven");
    }
    if (!proven && state.proof !== undefined) {
      fail(`${label} ${capability} proof`, "is only allowed when state is proven");
    }
    if (state.proof !== undefined) {
      const proof = record(state.proof, `${label} ${capability} proof`);
      number(proof.at, `${label} ${capability} proof at`);
      if (proof.observedNodeCount !== undefined) {
        number(proof.observedNodeCount, `${label} ${capability} proof observedNodeCount`);
      }
      if (proof.durationMs !== undefined) {
        number(proof.durationMs, `${label} ${capability} proof durationMs`);
      }
    }
    if (state.lastError !== undefined) {
      if (proven) {
        fail(`${label} ${capability} lastError`, "is not allowed when state is proven");
      }
      const lastError = record(state.lastError, `${label} ${capability} lastError`);
      number(lastError.at, `${label} ${capability} lastError at`);
      if (!targetRuntimeCapabilityReasons.has(String(lastError.reason))) {
        fail(`${label} ${capability} lastError reason`, "is unsupported");
      }
      if (lastError.observedNodeCount !== undefined) {
        number(lastError.observedNodeCount, `${label} ${capability} lastError observedNodeCount`);
      }
      if (lastError.durationMs !== undefined) {
        number(lastError.durationMs, `${label} ${capability} lastError durationMs`);
      }
      if (lastError.message !== undefined) {
        string(lastError.message, `${label} ${capability} lastError message`);
        if ((lastError.message as string).length > 480) {
          fail(`${label} ${capability} lastError message`, "must be at most 480 characters");
        }
      }
    }
    if (state.invalidated !== undefined) {
      if (!proven || state.freshness !== "stale" || capability !== "semanticControl") {
        fail(
          `${label} ${capability} invalidated`,
          "is only allowed for stale proven semantic control",
        );
      }
      const invalidated = record(state.invalidated, `${label} ${capability} invalidated`);
      number(invalidated.at, `${label} ${capability} invalidated at`);
      if (!new Set(["input-changed", "visual-changed"]).has(String(invalidated.reason))) {
        fail(
          `${label} ${capability} invalidated reason`,
          "must be input-changed or visual-changed",
        );
      }
    }
    if (proven && state.freshness === "stale" && state.invalidated === undefined) {
      fail(`${label} ${capability} invalidated`, "is required when a semantic proof is stale");
    }
    if (state.reason !== undefined && !targetRuntimeCapabilityReasons.has(String(state.reason))) {
      fail(`${label} ${capability} reason`, "is unsupported");
    }
    if (state.nextProbeAt !== undefined) {
      number(state.nextProbeAt, `${label} ${capability} nextProbeAt`);
      if (
        capability !== "semanticControl" ||
        state.state !== "unavailable" ||
        state.lastError === undefined ||
        record(state.lastError, `${label} ${capability} lastError`).reason !== "probe-failed"
      ) {
        fail(
          `${label} ${capability} nextProbeAt`,
          "is only allowed after an unavailable semantic probe failure",
        );
      }
    }
  }
}

const devicesParser = objectParser<{ devices: DeviceSummary[] }>("devices response", (input) => {
  if (!Array.isArray(input.devices)) fail("devices", "must be an array");
  for (const item of input.devices) {
    const device = record(item, "device");
    string(device.id, "device id");
    string(device.serial, "device serial");
    string(device.name, "device name");
    if (device.readiness !== undefined)
      assertTargetRuntimeReadiness(device.readiness, "device readiness");
  }
});

const targetDevicesInputParser = objectParser<{ phase?: "android" }>(
  "target devices input",
  (input) => {
    if (input.phase !== undefined && input.phase !== "android") {
      fail("target devices phase", "must be android when provided");
    }
  },
);

const actionsParser = objectParser<{ actions: ActionSummary[] }>("actions response", (input) => {
  if (!Array.isArray(input.actions)) fail("actions", "must be an array");
  for (const item of input.actions) {
    const action = record(item, "action");
    string(action.id, "action id");
    string(action.title, "action title");
  }
});

const screenshotParser = objectParser<OperationOutput<"target.screenshot.capture">>(
  "screenshot response",
  (input) => {
    string(input.path, "screenshot path");
    number(input.bytes, "screenshot bytes");
    if (input.readiness !== undefined) {
      assertTargetRuntimeReadiness(input.readiness, "screenshot readiness");
    }
  },
);

const targetSnapshotOutputParser = objectParser<OperationOutput<"target.snapshot.capture">>(
  "target snapshot response",
  (input) => {
    if (!Array.isArray(input.nodes)) fail("snapshot nodes", "must be an array");
    if (!Array.isArray(input.interactive)) fail("snapshot interactive", "must be an array");
    string(input.tree, "snapshot tree");
    if (input.readiness !== undefined) {
      assertTargetRuntimeReadiness(input.readiness, "snapshot readiness");
    }
    if (input.iosSessionLifecycle !== undefined) {
      assertIosSessionOperationLifecycle(
        input.iosSessionLifecycle,
        "snapshot iOS session lifecycle",
      );
    }
  },
);

const scrollSurveyReasons = new Set<ScrollSurveyStopReasonDto>([
  "end-of-content",
  "screen-changed",
  "inspection-unavailable",
  "missing-page-anchor",
  "seam-ambiguous",
  "dimension-changed",
  "scroll-failed",
  "restore-failed",
  "limit-reached",
]);

function assertScrollSurveyRect(value: unknown, label: string): void {
  const rect = record(value, label);
  number(rect.x, `${label} x`);
  number(rect.y, `${label} y`);
  number(rect.width, `${label} width`);
  number(rect.height, `${label} height`);
}

function assertScrollSurveyNode(value: unknown, label: string): void {
  const node = record(value, label);
  for (const field of ["index", "depth", "parentIndex"]) {
    if (node[field] !== undefined && !Number.isInteger(number(node[field], `${label} ${field}`))) {
      fail(`${label} ${field}`, "must be an integer");
    }
  }
  if (node.rect !== undefined) assertScrollSurveyRect(node.rect, `${label} rect`);
}

function assertScrollSurveySnapshot(value: unknown, label: string): void {
  const snapshot = record(value, label);
  if (snapshot.serial !== undefined) string(snapshot.serial, `${label} serial`);
  number(snapshot.capturedAt, `${label} capturedAt`);
  if (!Array.isArray(snapshot.nodes)) fail(`${label} nodes`, "must be an array");
  snapshot.nodes.forEach((node, index) => assertScrollSurveyNode(node, `${label} node ${index}`));
  if (!Array.isArray(snapshot.interactive)) fail(`${label} interactive`, "must be an array");
  snapshot.interactive.forEach((node, index) =>
    assertScrollSurveyNode(node, `${label} interactive node ${index}`),
  );
  if (snapshot.bounds !== undefined) {
    const bounds = record(snapshot.bounds, `${label} bounds`);
    number(bounds.width, `${label} bounds width`);
    number(bounds.height, `${label} bounds height`);
  }
  boolean(snapshot.inspectable, `${label} inspectable`);
  if (!new Set(["sdk", "android-system", "pixels-only"]).has(String(snapshot.source))) {
    fail(`${label} source`, "must be sdk, android-system, or pixels-only");
  }
  if (
    snapshot.inspectionState !== undefined &&
    !new Set(["active", "keyguard", "asleep", "unavailable", "unknown"]).has(
      String(snapshot.inspectionState),
    )
  ) {
    fail(`${label} inspectionState`, "is unsupported");
  }
  if (
    snapshot.bindingState !== undefined &&
    !new Set(["matched", "rebound", "unavailable"]).has(String(snapshot.bindingState))
  ) {
    fail(`${label} bindingState`, "is unsupported");
  }
  record(snapshot.screenIdentity, `${label} screenIdentity`);
  if (snapshot.proposedRows !== undefined) {
    if (!Array.isArray(snapshot.proposedRows)) fail(`${label} proposedRows`, "must be an array");
    snapshot.proposedRows.forEach((value, index) => {
      const row = record(value, `${label} proposed row ${index}`);
      number(row.x, `${label} proposed row ${index} x`);
      number(row.y, `${label} proposed row ${index} y`);
    });
  }
}

const targetScrollSurveyInputParser = objectParser<OperationInput<"target.scroll-survey.capture">>(
  "scroll survey input",
  (input) => {
    if (typeof input.serial !== "string" || !input.serial.trim()) {
      fail("scroll survey serial", "must be a non-empty string");
    }
    if (
      input.maxScrolls !== undefined &&
      (typeof input.maxScrolls !== "number" ||
        !Number.isInteger(input.maxScrolls) ||
        input.maxScrolls < 1 ||
        input.maxScrolls > 12)
    ) {
      fail("scroll survey maxScrolls", "must be an integer between 1 and 12");
    }
  },
);

const targetScrollSurveyOutputParser = objectParser<
  OperationOutput<"target.scroll-survey.capture">
>("scroll survey response", (input) => {
  if (input.status !== "completed" && input.status !== "stopped") {
    fail("scroll survey status", "must be completed or stopped");
  }
  if (!scrollSurveyReasons.has(input.reason as ScrollSurveyStopReasonDto)) {
    fail("scroll survey reason", "is unsupported");
  }
  if (!Array.isArray(input.frames) || input.frames.length === 0) {
    fail("scroll survey frames", "must be a non-empty array");
  }
  input.frames.forEach((value, index) => {
    const frame = record(value, `scroll survey frame ${index}`);
    if (!Number.isInteger(number(frame.index, `scroll survey frame ${index} index`))) {
      fail(`scroll survey frame ${index} index`, "must be an integer");
    }
    number(frame.offsetY, `scroll survey frame ${index} offsetY`);
    number(frame.appendedHeight, `scroll survey frame ${index} appendedHeight`);
    const screenshot = record(frame.screenshot, `scroll survey frame ${index} screenshot`);
    string(screenshot.base64, `scroll survey frame ${index} screenshot base64`);
    number(screenshot.width, `scroll survey frame ${index} screenshot width`);
    number(screenshot.height, `scroll survey frame ${index} screenshot height`);
    number(screenshot.capturedAt, `scroll survey frame ${index} screenshot capturedAt`);
    assertScrollSurveySnapshot(frame.snapshot, `scroll survey frame ${index} snapshot`);
  });
  if (!Array.isArray(input.diagnosticFrames)) {
    fail("scroll survey diagnosticFrames", "must be an array");
  }
  input.diagnosticFrames.forEach((value, index) => {
    const frame = record(value, `scroll survey diagnostic frame ${index}`);
    if (!Number.isInteger(number(frame.index, `scroll survey diagnostic frame ${index} index`))) {
      fail(`scroll survey diagnostic frame ${index} index`, "must be an integer");
    }
    number(frame.offsetY, `scroll survey diagnostic frame ${index} offsetY`);
    number(frame.appendedHeight, `scroll survey diagnostic frame ${index} appendedHeight`);
    const screenshot = record(
      frame.screenshot,
      `scroll survey diagnostic frame ${index} screenshot`,
    );
    string(screenshot.base64, `scroll survey diagnostic frame ${index} screenshot base64`);
    number(screenshot.width, `scroll survey diagnostic frame ${index} screenshot width`);
    number(screenshot.height, `scroll survey diagnostic frame ${index} screenshot height`);
    number(screenshot.capturedAt, `scroll survey diagnostic frame ${index} screenshot capturedAt`);
    assertScrollSurveySnapshot(frame.snapshot, `scroll survey diagnostic frame ${index} snapshot`);
  });
  if (input.stitched !== undefined) {
    const stitched = record(input.stitched, "scroll survey stitched preview");
    string(stitched.base64, "scroll survey stitched preview base64");
    number(stitched.width, "scroll survey stitched preview width");
    number(stitched.height, "scroll survey stitched preview height");
    if (stitched.mime !== "image/png") {
      fail("scroll survey stitched preview mime", "must be image/png");
    }
  }
  if (!Array.isArray(input.mergedNodes)) fail("scroll survey mergedNodes", "must be an array");
  input.mergedNodes.forEach((node, index) =>
    assertScrollSurveyNode(node, `scroll survey merged node ${index}`),
  );
  boolean(input.restoredStartViewport, "scroll survey restoredStartViewport");
  string(input.message, "scroll survey message");
});

const jobsParser = objectParser<OperationOutput<"job.list">>("jobs response", (input) => {
  if (!Array.isArray(input.jobs)) fail("jobs", "must be an array");
  for (const item of input.jobs) {
    const job = record(item, "job summary");
    string(job.id, "job summary id");
    string(job.action, "job summary action");
    string(job.status, "job summary status");
    number(job.queuedAt, "job summary queuedAt");
    number(job.frameCount, "job summary frameCount");
  }
});

const runsParser = objectParser<OperationOutput<"run.list">>("runs response", (input) => {
  if (!Array.isArray(input.runs)) fail("runs", "must be an array");
  for (const item of input.runs) {
    const run = record(item, "run summary");
    string(run.id, "run summary id");
    string(run.action, "run summary action");
    number(run.writtenAt, "run summary writtenAt");
    number(run.artifactCount, "run summary artifactCount");
    number(run.artifactBytes, "run summary artifactBytes");
    boolean(run.pinned, "run summary pinned");
  }
});

const runListInputParser = objectParser<OperationInput<"run.list">>("run list input", (input) => {
  if (input.limit !== undefined) {
    const raw = input.limit;
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < 1) fail("run list limit", "must be a positive number");
    input.limit = value;
  }
  if (input.appMapId !== undefined) string(input.appMapId, "run list App Map id");
});

const leaseListInputParser = objectParser<OperationInput<"lease.list">>(
  "lease list input",
  (input) => {
    if (input.status !== undefined && input.status !== "active" && input.status !== "all") {
      fail("lease list status", "must be active or all");
    }
  },
);

const leaseCreateInputParser = objectParser<OperationInput<"lease.create">>(
  "lease create input",
  (input) => {
    string(input.poolId, "lease create poolId");
    string(input.deviceSerial, "lease create deviceSerial");
    if (input.expiresAt !== undefined && number(input.expiresAt, "lease create expiresAt") <= 0) {
      fail("lease create expiresAt", "must be positive");
    }
  },
);

const leaseTakeoverInputParser = objectParser<OperationInput<"lease.takeover">>(
  "lease takeover input",
  (input) => {
    string(input.leaseId, "lease takeover leaseId");
    if (input.expiresAt !== undefined && number(input.expiresAt, "lease takeover expiresAt") <= 0) {
      fail("lease takeover expiresAt", "must be positive");
    }
    string(input.reason, "lease takeover reason");
    if (input.confirm !== true) fail("lease takeover confirm", "must be true");
  },
);

const jobIdInputParser = objectParser<{ jobId: string }>("job input", (input) => {
  string(input.jobId, "job id");
});

const runIdInputParser = objectParser<{ runId: string }>("run input", (input) => {
  string(input.runId, "run id");
});

const offlineRunReplayOutputParser = objectParser<OperationOutput<"run.replay.offline">>(
  "offline run replay response",
  (input) => {
    const report = record(input.report, "offline run replay report");
    if (report.schemaVersion !== 1) fail("offline run replay report schemaVersion", "must be 1");
    if (report.mode !== "offline-evidence-replay") {
      fail("offline run replay report mode", "must be offline-evidence-replay");
    }
    string(report.runId, "offline run replay report runId");
    string(report.sourceRunStatus, "offline run replay report sourceRunStatus");
    string(report.planDigest, "offline run replay report planDigest");
    const summary = record(report.summary, "offline run replay report summary");
    for (const key of [
      "checks",
      "proved",
      "rootFailures",
      "invalidCascades",
      "independentFailures",
    ]) {
      number(summary[key], `offline run replay report summary ${key}`);
    }
    for (const key of ["cursorTimeline", "checks", "blockers"]) {
      if (!Array.isArray(report[key])) {
        fail(`offline run replay report ${key}`, "must be an array");
      }
    }
  },
);

const runEvidenceInputParser = objectParser<OperationInput<"run.evidence.get">>(
  "run evidence input",
  (input) => {
    string(input.runId, "run id");
    if (input.limit !== undefined) {
      const rawLimit =
        typeof input.limit === "string"
          ? Number(input.limit)
          : number(input.limit, "run evidence limit");
      const limit = rawLimit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) {
        fail("run evidence limit", "must be an integer between 1 and 2000");
      }
    }
    if (input.includeBodies !== undefined) {
      if (
        input.includeBodies !== true &&
        input.includeBodies !== false &&
        input.includeBodies !== "true" &&
        input.includeBodies !== "false"
      ) {
        fail("includeBodies", "must be a boolean");
      }
    }
  },
);

const targetInputParser = objectParser<OperationRecord>("target operation", (input) => {
  string(input.serial, "target serial");
  if (input.previewX !== undefined) number(input.previewX, "previewX");
  if (input.previewY !== undefined) number(input.previewY, "previewY");
  if (input.preview !== undefined) boolean(input.preview, "preview");
  if (input.visual !== undefined && input.visual !== true && input.visual !== false) {
    if (
      input.visual !== "true" &&
      input.visual !== "false" &&
      input.visual !== "1" &&
      input.visual !== "0"
    ) {
      fail("visual", "must be a boolean");
    }
  }
});

function assertIosMutationAttemptDiagnostic(
  value: unknown,
  label: string,
): asserts value is IosMutationAttemptDiagnosticDto {
  const diagnostic = record(value, label);
  const sequence = number(diagnostic.sequence, `${label} sequence`);
  if (!Number.isInteger(sequence) || sequence < 1) {
    fail(`${label} sequence`, "must be a positive integer");
  }
  string(diagnostic.operation, `${label} operation`);
  if (diagnostic.nativeAttempts !== 1) fail(`${label} nativeAttempts`, "must be exactly one");
  if (
    diagnostic.outcome !== "completed" &&
    diagnostic.outcome !== "selector-miss" &&
    diagnostic.outcome !== "outcome-unknown"
  ) {
    fail(`${label} outcome`, "is unsupported");
  }
  const retry = record(diagnostic.retry, `${label} retry`);
  if (retry.attempts !== 0) fail(`${label} retry attempts`, "must be zero");
  if (
    retry.decision !== "not-needed" &&
    retry.decision !== "safe-selector-fallback" &&
    retry.decision !== "blocked"
  ) {
    fail(`${label} retry decision`, "is unsupported");
  }
  if (
    retry.reason !== "native-command-completed" &&
    retry.reason !== "selector-was-not-dispatched" &&
    retry.reason !== "native-command-outcome-unknown"
  ) {
    fail(`${label} retry reason`, "is unsupported");
  }
  const intervention = record(diagnostic.intervention, `${label} intervention`);
  boolean(intervention.required, `${label} intervention required`);
  if (
    intervention.action !== "none" &&
    intervention.action !== "capture-current-screen-before-any-retry"
  ) {
    fail(`${label} intervention action`, "is unsupported");
  }
  if (diagnostic.cancellation !== undefined) {
    const cancellation = record(diagnostic.cancellation, `${label} cancellation`);
    if (cancellation.observedAfterAttemptStarted !== true) {
      fail(`${label} cancellation observedAfterAttemptStarted`, "must be true");
    }
  }
  number(diagnostic.at, `${label} at`);
}

const stepRunOutputParser = objectParser<OperationOutput<"step.run">>(
  "standalone step response",
  (input) => {
    const response = input as unknown as OperationRecord;
    boolean(response.ok, "standalone step ok");
    number(response.durationMs, "standalone step durationMs");
    if (!Array.isArray(response.logs) || response.logs.some((entry) => typeof entry !== "string")) {
      fail("standalone step logs", "must be an array of strings");
    }
    if (response.ok === true) {
      if (response.terminal !== undefined) {
        fail("standalone step terminal", "is only valid on failure");
      }
      return;
    }
    string(response.error, "standalone step error");
    if (response.code === undefined) {
      if (response.terminal !== undefined) fail("standalone step terminal", "is unsupported");
      return;
    }
    if (response.code !== "IOS_MUTATION_OUTCOME_UNKNOWN") {
      fail("standalone step code", "is unsupported");
    }
    if (response.terminal !== "review-needed") {
      fail("standalone step terminal", "must be review-needed for an unknown iOS outcome");
    }
    assertIosMutationAttemptDiagnostic(response.iosMutation, "standalone step iOS mutation");
    const mutation = response.iosMutation as IosMutationAttemptDiagnosticDto;
    if (
      mutation.outcome !== "outcome-unknown" ||
      mutation.retry.decision !== "blocked" ||
      mutation.retry.reason !== "native-command-outcome-unknown" ||
      mutation.intervention.required !== true ||
      mutation.intervention.action !== "capture-current-screen-before-any-retry"
    ) {
      fail("standalone step iOS mutation", "must describe a blocked unknown outcome");
    }
    if (response.iosSessionLifecycle !== undefined) {
      assertIosSessionOperationLifecycle(
        response.iosSessionLifecycle,
        "standalone step iOS session lifecycle",
      );
    }
    if (response.iosVisualVerification !== undefined) {
      record(response.iosVisualVerification, "standalone step iOS visual verification");
    }
    const review = record(response.stepReview, "standalone step review");
    const captureCurrent = record(review.captureCurrent, "standalone step review captureCurrent");
    if (captureCurrent.operationId !== "target.screenshot.capture") {
      fail("standalone step review captureCurrent operationId", "must capture a target screenshot");
    }
    const captureInput = record(
      captureCurrent.input,
      "standalone step review captureCurrent input",
    );
    string(captureInput.serial, "standalone step review captureCurrent serial");
  },
);

const targetAppLaunchInputParser = objectParser<OperationInput<"target.app.launch">>(
  "target app launch input",
  (input) => {
    string(input.serial, "target app launch serial");
    string(input.app, "target app launch app");
    if (input.relaunch !== undefined) boolean(input.relaunch, "target app launch relaunch");
  },
);

const targetAppLaunchOutputParser = objectParser<OperationOutput<"target.app.launch">>(
  "target app launch response",
  (input) => {
    const launched = record(input.launched, "launched app");
    string(launched.serial, "launched app serial");
    string(launched.app, "launched app name");
    if (launched.platform !== "android" && launched.platform !== "ios") {
      fail("launched app platform", "must be android or ios");
    }
    number(launched.launchedAt, "launched app timestamp");
  },
);

const targetAppLocalesInputParser = objectParser<OperationInput<"target.app.locales">>(
  "target app locales input",
  (input) => {
    string(input.serial, "target app locales serial");
    string(input.package, "target app locales package");
  },
);

const targetAppLocalesOutputParser = objectParser<OperationOutput<"target.app.locales">>(
  "target app locales response",
  (input) => {
    string(input.packageName, "target app locales package name");
    if (!Array.isArray(input.locales)) fail("target app locales", "must be an array");
    for (const locale of input.locales) string(locale, "target app locale");
  },
);

const targetRecoverInputParser = objectParser<OperationInput<"target.recover">>(
  "target recovery input",
  (input) => {
    string(input.serial, "target recovery serial");
    if (
      input.reason !== undefined &&
      (typeof input.reason !== "string" ||
        !["connect", "observe", "control", "record", "auto"].includes(input.reason))
    ) {
      fail("target recovery reason", "must be connect, observe, control, record, or auto");
    }
  },
);

const targetRecoverOutputParser = objectParser<OperationOutput<"target.recover">>(
  "target recovery response",
  (input) => {
    const recovery = record(input.recovery, "target recovery");
    string(recovery.serial, "target recovery serial");
    boolean(recovery.recovered, "target recovered");
    boolean(recovery.ready, "target ready");
    string(recovery.summary, "target recovery summary");
    if (!Array.isArray(recovery.actions)) fail("target recovery actions", "must be an array");
    for (const value of recovery.actions as unknown[]) {
      const action = record(value, "target recovery action");
      if (!["stale-lock", "agent-device", "core-device"].includes(String(action.kind))) {
        fail("target recovery action kind", "is invalid");
      }
      if (!["completed", "skipped", "failed"].includes(String(action.status))) {
        fail("target recovery action status", "is invalid");
      }
      string(action.detail, "target recovery action detail");
    }
    const session = record(recovery.session, "target recovery session");
    if (session.status !== "restored" && session.status !== "unavailable") {
      fail("target recovery session status", "must be restored or unavailable");
    }
    if (session.app !== undefined) string(session.app, "target recovery session app");
    if (session.fallback !== undefined)
      boolean(session.fallback, "target recovery session fallback");
    string(session.detail, "target recovery session detail");
    if (recovery.readiness !== undefined) {
      assertTargetRuntimeReadiness(recovery.readiness, "target recovery readiness");
    }
  },
);

const recipeRefParser = objectParser<OperationRecord>("recipe reference", (input) => {
  string(input.recipeId, "recipeId");
});

const recipeWriteParser = objectParser<OperationRecord>("recipe write", (input) => {
  if (input.recipeId !== undefined) string(input.recipeId, "recipeId");
  number(input.expectedRevision, "expectedRevision");
  string(input.title, "title");
  if (!Array.isArray(input.steps)) fail("steps", "must be an array");
});

const recipeImportParser = objectParser<OperationRecord>("recipe import", (input) => {
  string(input.yaml, "yaml");
});

const recipeEvidenceParser = objectParser<OperationRecord>("recipe evidence", (input) => {
  string(input.recipeId, "recipeId");
  string(input.evidenceId, "evidenceId");
  string(input.mime, "mime");
  string(input.base64, "base64");
});

const recipeHistoryRestoreParser = objectParser<OperationRecord>(
  "recipe history restore",
  (input) => {
    string(input.recipeId, "recipeId");
    number(input.updatedAt, "updatedAt");
  },
);

const genericObjectOutputParser = objectParser<OperationRecord>("operation response");

const startJobInputParser = objectParser<OperationInput<"job.start">>("job input", (input) => {
  string(input.recipe, "job recipe");
});

const enabledInputParser = objectParser<{ enabled: boolean }>("enabled input", (input) => {
  boolean(input.enabled, "enabled");
});

const redactionPolicyParser = objectParser<{ policy: RedactionPolicyDto }>(
  "redaction policy response",
  (input) => {
    const policy = record(input.policy, "redaction policy");
    boolean(policy.enabled, "redaction enabled");
    string(policy.source, "redaction source");
    boolean(policy.locked, "redaction locked");
  },
);

const evidencePolicyParser = objectParser<{ policy: EvidenceCollectionPolicyDto }>(
  "evidence policy response",
  (input) => {
    const policy = record(input.policy, "evidence policy");
    if (policy.schemaVersion !== 1) fail("evidence policy schemaVersion", "must be 1");
    record(policy.sensitive, "evidence policy sensitive grants");
  },
);

const revisionedVariablesParser = objectParser<RevisionedDto<TestDataDto[]>>(
  "variables response",
  (input) => {
    number(input.revision, "variables revision");
    number(input.updatedAt, "variables updatedAt");
    if (!Array.isArray(input.value)) fail("variables value", "must be an array");
  },
);

const visualCompareInputParser = objectParser<OperationInput<"run.visual.compare">>(
  "visual comparison input",
  (input) => string(input.runId, "visual comparison runId"),
);

const runReviewInputParser = objectParser<OperationInput<"run.review">>(
  "run review input",
  (input) => {
    string(input.runId, "run review runId");
    if (input.action !== "approve" && input.action !== "reject") {
      fail("run review action", 'must be "approve" or "reject"');
    }
    if (input.note !== undefined) string(input.note, "run review note");
  },
);

const runReviewOutputParser = objectParser<OperationOutput<"run.review">>(
  "run review response",
  (input) => {
    record(input.run, "run review run");
    record(input.review, "run review decision");
  },
);

const visualReviewInputParser = objectParser<OperationInput<"run.visual.review">>(
  "visual review input",
  (input) => {
    string(input.runId, "visual review runId");
    string(input.comparisonId, "visual review comparisonId");
    const action = string(input.action, "visual review action");
    if (
      ![
        "approve-new-baseline",
        "keep-baseline",
        "fix-connection",
        "retry",
        "mark-expected-variation",
      ].includes(action)
    ) {
      fail("visual review action", "is unsupported");
    }
    if (input.note !== undefined) string(input.note, "visual review note");
  },
);

function assertVisualRegion(value: unknown, index: number): void {
  const region = record(value, `visual region ${index + 1}`);
  string(region.id, `visual region ${index + 1} id`);
  string(region.name, `visual region ${index + 1} name`);
  if (region.mode !== "compare" && region.mode !== "ignore") {
    fail(`visual region ${index + 1} mode`, "must be compare or ignore");
  }
  const frameIndex = number(region.frameIndex, `visual region ${index + 1} frameIndex`);
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    fail(`visual region ${index + 1} frameIndex`, "must be a non-negative integer");
  }
  const x = number(region.x, `visual region ${index + 1} x`);
  const y = number(region.y, `visual region ${index + 1} y`);
  const width = number(region.width, `visual region ${index + 1} width`);
  const height = number(region.height, `visual region ${index + 1} height`);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    fail(`visual region ${index + 1}`, "must fit inside normalized frame bounds");
  }
}

const visualPolicyGetInputParser = objectParser<OperationInput<"run.visual-policy.get">>(
  "visual policy input",
  (input) => string(input.runId, "visual policy runId"),
);

const visualPolicyUpdateInputParser = objectParser<OperationInput<"run.visual-policy.update">>(
  "visual policy update input",
  (input) => {
    string(input.runId, "visual policy runId");
    const revision = number(input.expectedRevision, "visual policy expectedRevision");
    if (!Number.isInteger(revision) || revision < 0)
      fail("visual policy expectedRevision", "must be a non-negative integer");
    const changeThreshold = number(input.changeThreshold, "visual policy changeThreshold");
    if (changeThreshold < 0 || changeThreshold > 1)
      fail("visual policy changeThreshold", "must be between 0 and 1");
    const pixelThreshold = number(input.pixelThreshold, "visual policy pixelThreshold");
    if (!Number.isInteger(pixelThreshold) || pixelThreshold < 0 || pixelThreshold > 255)
      fail("visual policy pixelThreshold", "must be an integer from 0 to 255");
    if (!Array.isArray(input.regions) || input.regions.length > 100)
      fail("visual policy regions", "must be an array with at most 100 regions");
    input.regions.forEach(assertVisualRegion);
  },
);

const visualBaselineInputParser = objectParser<OperationInput<"run.visual-baseline.update">>(
  "visual baseline input",
  (input) => {
    string(input.runId, "visual baseline runId");
    if (input.action !== "approve-new-baseline") {
      fail("visual baseline action", "must be approve-new-baseline");
    }
    if (input.note !== undefined) string(input.note, "visual baseline note");
  },
);

const visualComparisonOutputParser = objectFieldParser<OperationOutput<"run.visual.compare">>(
  "visual comparison response",
  "comparison",
);

const visualReviewOutputParser = objectParser<OperationOutput<"run.visual.review">>(
  "visual review response",
  (input) => {
    record(input.decision, "visual review decision");
    if (input.baseline !== null) record(input.baseline, "visual review baseline");
  },
);

const visualBaselineOutputParser = objectParser<OperationOutput<"run.visual-baseline.update">>(
  "visual baseline response",
  (input) => {
    record(input.comparison, "visual baseline comparison");
    record(input.decision, "visual baseline decision");
    record(input.baseline, "visual baseline");
  },
);

const visualPolicyOutputParser = objectParser<OperationOutput<"run.visual-policy.get">>(
  "visual policy response",
  (input) => record(input.policy, "visual comparison policy"),
);

const visualPolicyUpdateOutputParser = objectParser<OperationOutput<"run.visual-policy.update">>(
  "visual policy update response",
  (input) => {
    record(input.policy, "visual comparison policy");
    record(input.comparison, "visual comparison");
  },
);

const buildPreflightInputParser = objectParser<OperationInput<"build.preflight">>(
  "build preflight input",
  (input) => {
    string(input.buildId, "build preflight buildId");
    if (input.serial !== undefined) string(input.serial, "build preflight serial");
  },
);

const buildInstallInputParser = objectParser<OperationInput<"build.install">>(
  "build install input",
  (input) => {
    string(input.buildId, "build install buildId");
    string(input.serial, "build install serial");
    if (input.launch !== undefined) boolean(input.launch, "build install launch");
    if (input.applicationId !== undefined)
      string(input.applicationId, "build install applicationId");
  },
);

const buildInstallOutputParser = objectParser<OperationOutput<"build.install">>(
  "build install response",
  (input) => {
    record(input.installed, "installed build");
    if (input.launched !== undefined) record(input.launched, "launched build");
  },
);

const buildLaunchInputParser = objectParser<OperationInput<"build.launch">>(
  "build launch input",
  (input) => {
    string(input.buildId, "build launch buildId");
    string(input.serial, "build launch serial");
    if (input.applicationId !== undefined)
      string(input.applicationId, "build launch applicationId");
  },
);

const poolPreflightInputParser = objectParser<OperationInput<"device-pool.preflight">>(
  "device pool preflight input",
  (input) => string(input.poolId, "device pool preflight poolId"),
);

const generationInputParser = objectParser<GenerationRequestDto>("generation input", (input) => {
  if (input.purpose !== "variable" && input.purpose !== "test-plan") {
    fail("generation purpose", "must be variable or test-plan");
  }
  string(input.prompt, "generation prompt");
  if (
    input.allowedValues !== undefined &&
    (!Array.isArray(input.allowedValues) ||
      input.allowedValues.some((value) => typeof value !== "string" || !value.trim()))
  ) {
    fail("generation allowedValues", "must contain non-empty strings");
  }
});

const generationOutputParser = objectParser<GenerationResultDto>("generation response", (input) => {
  string(input.provider, "generation provider");
  string(input.model, "generation model");
  if (!Array.isArray(input.values) || input.values.some((value) => typeof value !== "string")) {
    fail("generation values", "must be an array of strings");
  }
  number(input.generatedAt, "generation generatedAt");
  if (input.usage !== undefined) {
    const usage = record(input.usage, "generation usage");
    for (const field of ["inputTokens", "outputTokens", "totalTokens", "costUsd"] as const) {
      if (usage[field] !== undefined) number(usage[field], `generation usage ${field}`);
    }
  }
  if (input.provenance !== undefined) {
    const provenance = record(input.provenance, "generation provenance");
    string(provenance.requestId, "generation provenance requestId");
    string(provenance.promptDigest, "generation provenance promptDigest");
    number(provenance.startedAt, "generation provenance startedAt");
    number(provenance.completedAt, "generation provenance completedAt");
    number(provenance.durationMs, "generation provenance durationMs");
  }
});

const authoringSessionRefParser = objectParser<OperationRecord>(
  "authoring session input",
  assertAuthoringSessionRef,
);

const createAuthoringSessionParser = objectParser<CreateAuthoringSessionInput>(
  "create authoring session input",
  (input) => {
    string(input.appMapId, "appMapId");
    string(input.leaseId, "leaseId");
    const target = record(input.target, "authoring target");
    string(target.targetId, "authoring target targetId");
    if (target.kind !== "device" && target.kind !== "browser") {
      fail("authoring target kind", "must be device or browser");
    }
    if (!(["android", "ios", "browser"] as unknown[]).includes(target.platform)) {
      fail("authoring target platform", "must be android, ios, or browser");
    }
    if (
      (target.kind === "browser" && target.platform !== "browser") ||
      (target.kind === "device" && target.platform === "browser")
    ) {
      fail("authoring target", "kind and platform do not describe the same target");
    }
    if (number(input.expectedAppMapRevision, "expectedAppMapRevision") < 0) {
      fail("expectedAppMapRevision", "must be non-negative");
    }
    if (input.sourceScreenId !== undefined) string(input.sourceScreenId, "sourceScreenId");
    if (input.pendingConnectionId !== undefined)
      string(input.pendingConnectionId, "pendingConnectionId");
    if (input.group !== undefined) string(input.group, "group");
  },
);

function assertAuthoringInteraction(value: unknown): void {
  const interaction = record(value, "authoring interaction");
  const kind = string(interaction.kind, "authoring interaction kind");
  if (interaction.applied !== undefined)
    boolean(interaction.applied, "authoring interaction applied");
  switch (kind) {
    case "tap":
      record(interaction.target, "tap target");
      return;
    case "type":
      string(interaction.text, "type text");
      if (interaction.target !== undefined) record(interaction.target, "type target");
      if (
        interaction.mode !== undefined &&
        interaction.mode !== "append" &&
        interaction.mode !== "replace"
      )
        fail("type mode", "must be append or replace");
      if (interaction.mode === "replace" && interaction.target === undefined)
        fail("type target", "is required in replace mode");
      return;
    case "clipboard":
      if (!(["write", "read", "paste", "copy"] as unknown[]).includes(interaction.action))
        fail("clipboard action", "must be write, read, paste, or copy");
      if (interaction.text !== undefined) string(interaction.text, "clipboard text");
      if (interaction.expect !== undefined) string(interaction.expect, "clipboard expectation");
      if (interaction.target !== undefined) record(interaction.target, "clipboard target");
      if (
        interaction.match !== undefined &&
        !["exact", "contains"].includes(String(interaction.match))
      )
        fail("clipboard match", "must be exact or contains");
      return;
    case "app":
      if (
        ![
          "open",
          "close",
          "switcher",
          "inspect",
          "assert-installed",
          "assert-not-installed",
          "install",
          "update",
          "uninstall",
        ].includes(String(interaction.action))
      )
        fail("app action", "is not supported");
      for (const field of ["app", "url", "artifact", "as", "version"] as const) {
        if (interaction[field] !== undefined) string(interaction[field], `app ${field}`);
      }
      if (interaction.relaunch !== undefined) boolean(interaction.relaunch, "app relaunch");
      if (
        interaction.versionMatch !== undefined &&
        !["exact", "contains"].includes(String(interaction.versionMatch))
      )
        fail("app versionMatch", "must be exact or contains");
      return;
    case "device":
      if (
        !["lock", "unlock", "keyboard-dismiss", "keyboard-enter"].includes(
          String(interaction.action),
        )
      )
        fail("device action", "is not supported");
      return;
    case "rotate":
      if (
        !["portrait", "portrait-upside-down", "landscape-left", "landscape-right"].includes(
          String(interaction.orientation),
        )
      )
        fail("rotation orientation", "is not supported");
      return;
    case "swipe":
      record(interaction.from, "swipe from");
      record(interaction.to, "swipe to");
      if (
        interaction.durationMs !== undefined &&
        number(interaction.durationMs, "swipe duration") < 0
      )
        fail("swipe duration", "must be non-negative");
      return;
    case "key":
      if (interaction.key !== "back" && interaction.key !== "home")
        fail("authoring key", "must be back or home");
      return;
    case "wait":
      if (number(interaction.ms, "wait ms") < 0) fail("wait ms", "must be non-negative");
      return;
    case "observe":
    case "screenshot":
      if (interaction.label !== undefined) string(interaction.label, "observe label");
      return;
    case "reusable":
      string(interaction.recipeId, "reusable recipeId");
      if (interaction.bindings !== undefined) record(interaction.bindings, "reusable bindings");
      return;
    case "steps":
      if (!Array.isArray(interaction.steps)) fail("manual steps", "must be an array");
      for (const step of interaction.steps) record(step, "manual step");
      if (interaction.label !== undefined) string(interaction.label, "manual step label");
      return;
    default:
      fail("authoring interaction kind", `unsupported kind ${kind}`);
  }
}

const authoringInteractionParser = objectParser<{
  sessionId: string;
  interaction: AuthoringInteraction;
}>("authoring interaction input", (input) => {
  assertAuthoringSessionRef(input);
  assertAuthoringInteraction(input.interaction);
});

const trimAuthoringTakeParser = objectParser<TrimAuthoringTakeInput>(
  "trim authoring Take input",
  (input) => {
    assertAuthoringSessionRef(input);
    const fromMs = input.fromMs === undefined ? undefined : number(input.fromMs, "trim fromMs");
    const toMs = input.toMs === undefined ? undefined : number(input.toMs, "trim toMs");
    if (fromMs !== undefined && fromMs < 0) fail("trim fromMs", "must be non-negative");
    if (toMs !== undefined && toMs < 0) fail("trim toMs", "must be non-negative");
    if (fromMs !== undefined && toMs !== undefined && fromMs > toMs)
      fail("trim range", "fromMs must not exceed toMs");
    if (
      input.actionIds !== undefined &&
      (!Array.isArray(input.actionIds) ||
        input.actionIds.some((id) => typeof id !== "string" || !id))
    )
      fail("trim actionIds", "must be non-empty strings");
  },
);

const reorderAuthoringTakeParser = objectParser<ReorderAuthoringTakeInput>(
  "reorder authoring Take input",
  (input) => {
    assertAuthoringSessionRef(input);
    if (
      !Array.isArray(input.actionIds) ||
      input.actionIds.some((id) => typeof id !== "string" || !id)
    )
      fail("reorder actionIds", "must be non-empty strings");
  },
);

const replaceAuthoringActionParser = objectParser<ReplaceAuthoringActionInput>(
  "replace authoring action input",
  (input) => {
    assertAuthoringSessionRef(input);
    string(input.actionId, "actionId");
    assertAuthoringInteraction(input.interaction);
  },
);

const commitAuthoringSessionParser = objectParser<CommitAuthoringSessionInput>(
  "commit authoring session input",
  (input) => {
    assertAuthoringSessionRef(input);
    if (
      input.mode !== undefined &&
      !["interaction", "automatic", "reusable"].includes(String(input.mode))
    )
      fail("authoring mode", "must be interaction, automatic, or reusable");
    if (input.destination !== undefined) {
      const destination = record(input.destination, "authoring destination");
      if (!["new-screen", "screen", "end"].includes(String(destination.kind)))
        fail("authoring destination kind", "must be new-screen, screen, or end");
      if (destination.kind === "screen") string(destination.screenId, "destination screenId");
      if (destination.kind === "new-screen" && destination.title !== undefined)
        string(destination.title, "destination title");
    }
  },
);

const authoringSessionResponseParser: RuntimeParser<AuthoringSessionResponse> = {
  description: "authoring session response",
  parse: parseAuthoringSessionResponse,
};

const authoringSessionListParser: RuntimeParser<AuthoringSessionListResponse> = {
  description: "authoring session list response",
  parse: parseAuthoringSessionListResponse,
};

const authoringSessionListInputParser = objectParser<OperationInput<"authoring.session.list">>(
  "authoring session list input",
  (input) => {
    if (input.appMapId !== undefined) string(input.appMapId, "authoring App Map id");
    if (input.targetId !== undefined) string(input.targetId, "authoring target id");
    if (input.activeOnly !== undefined) {
      if (input.activeOnly === "true") input.activeOnly = true;
      if (input.activeOnly === "false") input.activeOnly = false;
      boolean(input.activeOnly, "authoring activeOnly");
    }
  },
);

const { command, query } = createOperationBuilders<OperationId>(operationRecordParser);

const discoveryOperationDefinitions = createDiscoveryOperationDefinitions(operationRecordParser);

const corpusOperationDefinitions = createCorpusOperationDefinitions(operationRecordParser);

const appMapOperationDefinitions = createAppMapOperationDefinitions(operationRecordParser, {
  boolean,
  emptyInputParser,
  fail,
  number,
  objectFieldParser,
  objectParser,
  okParser,
  record,
  string,
});

export const operationDefinitions = [
  query("system.health.get", "Get Relay health", "/health", {
    category: "system",
    input: emptyInputParser,
    output: healthParser,
  }),
  query("system.doctor.get", "Inspect Relay prerequisites", "/doctor", { category: "system" }),
  query("system.audit.list", "List audit events", "/audit", {
    category: "system",
    minimumRole: "admin",
  }),
  query("activity.list", "List durable project activity", "/activity", {
    category: "workspace",
    minimumRole: "admin",
  }),
  query("activity.export", "Export project activity", "/activity/export", {
    category: "workspace",
    minimumRole: "admin",
    input: emptyInputParser,
    output: activityExportParser,
  }),
  query("event.stream", "Stream Relay events", "/events", {
    category: "system",
    mode: "stream",
  }),
  query("presence.list", "List project presence", "/presence", { category: "system" }),
  command("presence.upsert", "Publish actor presence", "POST", "/presence", {
    category: "system",
    idempotency: "inherent",
  }),
  command("presence.clear", "Clear actor presence", "DELETE", "/presence/:actorId", {
    category: "system",
    idempotency: "inherent",
  }),
  query("workspace.privacy.get", "Get privacy policy", "/settings/privacy", {
    minimumRole: "admin",
    input: emptyInputParser,
    output: redactionPolicyParser,
  }),
  command("workspace.privacy.update", "Update privacy policy", "PUT", "/settings/privacy", {
    input: enabledInputParser,
    output: redactionPolicyParser,
  }),
  query("workspace.evidence.get", "Get evidence policy", "/settings/evidence", {
    minimumRole: "admin",
    input: emptyInputParser,
    output: evidencePolicyParser,
  }),
  command("workspace.evidence.update", "Update evidence consent", "PUT", "/settings/evidence", {
    input: objectParser("evidence consent", (input) => {
      string(input.channel, "evidence channel");
      boolean(input.enabled, "evidence enabled");
    }),
    output: evidencePolicyParser,
    confirmation: "confirm",
  }),
  command(
    "workspace.apple-device.update",
    "Update Apple device setup",
    "PUT",
    "/settings/devices/apple",
    { confirmation: "confirm" },
  ),
  query("target.actions.list", "List available actions", "/actions", {
    category: "target",
    input: emptyInputParser,
    output: actionsParser,
  }),
  query("target.devices.list", "List connected targets", "/devices", {
    category: "target",
    input: targetDevicesInputParser,
    output: devicesParser,
  }),
  query("target.list", "List managed targets", "/targets", { category: "target" }),
  command("target.create", "Create managed target", "POST", "/targets", {
    category: "target",
    minimumRole: "admin",
  }),
  command("target.delete", "Delete managed target", "DELETE", "/targets/:targetId", {
    category: "target",
    minimumRole: "admin",
  }),
  command("target.preflight", "Check target readiness", "POST", "/targets/:targetId/preflight", {
    category: "target",
    idempotency: "inherent",
  }),
  command("target.open", "Open managed target", "POST", "/targets/:targetId/open", {
    category: "target",
    confirmation: "confirm",
  }),
  command("target.boot", "Boot target", "POST", "/device/boot", { category: "target" }),
  command("target.authorize", "Authorize target", "POST", "/device/authorize", {
    category: "target",
    confirmation: "confirm",
    minimumRole: "admin",
  }),
  query("target.snapshot.capture", "Capture target structure", "/snapshot", {
    category: "evidence",
    targetCapabilities: ["snapshot"],
    lease: "shared",
    input: targetInputParser,
    output: targetSnapshotOutputParser,
  }),
  query("target.screenshot.capture", "Capture target screenshot", "/screenshot", {
    category: "evidence",
    targetCapabilities: ["screenshot"],
    lease: "shared",
    input: targetInputParser,
    output: screenshotParser,
  }),
  command(
    "target.scroll-survey.capture",
    "Capture a bounded scrollable-page survey",
    "POST",
    "/capture/scroll-survey",
    {
      category: "target",
      targetCapabilities: ["scroll", "snapshot", "screenshot"],
      lease: "exclusive",
      input: targetScrollSurveyInputParser,
      output: targetScrollSurveyOutputParser,
      progress: false,
      cancellable: false,
    },
  ),
  command("target.app.launch", "Launch app on target", "POST", "/device/app/launch", {
    category: "target",
    targetCapabilities: ["launch"],
    lease: "exclusive",
    idempotency: "inherent",
    input: targetAppLaunchInputParser,
    output: targetAppLaunchOutputParser,
  }),
  query("target.app.locales", "List app-declared locales", "/device/app/locales", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "shared",
    input: targetAppLocalesInputParser,
    output: targetAppLocalesOutputParser,
  }),
  command("target.recover", "Repair target connection", "POST", "/device/recover", {
    category: "target",
    targetCapabilities: ["snapshot", "tap"],
    lease: "exclusive",
    idempotency: "inherent",
    input: targetRecoverInputParser,
    output: targetRecoverOutputParser,
  }),
  command("target.interact", "Interact with target", "POST", "/interact", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
    input: targetInputParser,
  }),
  command("target.ground", "Ground a text or structured target", "POST", "/ground", {
    category: "target",
    targetCapabilities: ["snapshot", "screenshot"],
    lease: "shared",
    input: targetInputParser,
  }),
  command("target.do", "Ground a text target then interact", "POST", "/do", {
    category: "target",
    targetCapabilities: ["tap", "snapshot", "screenshot"],
    lease: "exclusive",
    input: targetInputParser,
  }),
  query("target.ui.describe", "Describe target UI context", "/target/ui", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "shared",
    input: targetInputParser,
  }),
  command("target.ui.back", "Sheet-aware back / dismiss toward parent", "POST", "/target/ui/back", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
    input: targetInputParser,
  }),
  command(
    "target.ui.scrollCollect",
    "Scroll list and collect interactive controls",
    "POST",
    "/target/ui/scroll-collect",
    {
      category: "target",
      targetCapabilities: ["scroll", "snapshot"],
      lease: "exclusive",
      input: targetInputParser,
    },
  ),
  command("target.touch", "Send target touch", "POST", "/device/touch", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
    input: targetInputParser,
  }),
  command("target.key", "Send target key", "POST", "/device/key", {
    category: "target",
    targetCapabilities: ["type"],
    lease: "exclusive",
    input: targetInputParser,
  }),
  command("target.scroll", "Scroll target", "POST", "/device/scroll", {
    category: "target",
    targetCapabilities: ["scroll"],
    lease: "exclusive",
    input: targetInputParser,
  }),
  command("target.video.start", "Start target video", "POST", "/device/video", {
    category: "evidence",
    minimumRole: "runner",
    targetCapabilities: ["recording"],
    lease: "shared",
    input: targetInputParser,
  }),
  query("target.stream.open", "Stream live target video", "/device/stream", {
    category: "target",
    mode: "stream",
    targetCapabilities: ["observe"],
    lease: "shared",
  }),
  query("project.list", "List projects", "/projects", {
    input: emptyInputParser,
    output: arrayFieldParser("projects response", "projects"),
  }),
  command("project.save", "Save project", "POST", "/projects", {
    output: objectFieldParser("project response", "project"),
  }),
  query("build.list", "List builds", "/builds", {
    input: emptyInputParser,
    output: arrayFieldParser("builds response", "builds"),
  }),
  command("build.save", "Save build", "POST", "/builds", {
    output: objectFieldParser("build response", "build"),
  }),
  command("build.preflight", "Preflight build", "POST", "/builds/:buildId/preflight", {
    category: "target",
    input: buildPreflightInputParser,
    output: objectFieldParser<OperationOutput<"build.preflight">>(
      "build preflight response",
      "preflight",
    ),
  }),
  command("build.install", "Install build", "POST", "/builds/:buildId/install", {
    category: "target",
    targetCapabilities: ["install"],
    lease: "exclusive",
    confirmation: "confirm",
    input: buildInstallInputParser,
    output: buildInstallOutputParser,
  }),
  command("build.launch", "Launch build", "POST", "/builds/:buildId/launch", {
    category: "target",
    targetCapabilities: ["launch"],
    lease: "exclusive",
    input: buildLaunchInputParser,
    output: objectFieldParser<OperationOutput<"build.launch">>("build launch response", "launched"),
  }),
  query("device-pool.list", "List device pools", "/device-pools", {
    input: emptyInputParser,
    output: arrayFieldParser("device pools response", "pools"),
  }),
  command("device-pool.save", "Save device pool", "POST", "/device-pools", {
    output: objectFieldParser("device pool response", "pool"),
  }),
  command(
    "device-pool.preflight",
    "Preflight device pool",
    "POST",
    "/device-pools/:poolId/preflight",
    {
      category: "target",
      input: poolPreflightInputParser,
      output: objectFieldParser<OperationOutput<"device-pool.preflight">>(
        "device pool preflight response",
        "preflight",
      ),
    },
  ),
  query("target-worker.list", "List target workers", "/target-workers", {
    category: "target",
    input: emptyInputParser,
    output: arrayFieldParser<OperationOutput<"target-worker.list">>(
      "target workers response",
      "workers",
    ),
  }),
  query("lease.list", "List target leases", "/device-leases", {
    input: leaseListInputParser,
    output: arrayFieldParser("leases response", "leases"),
  }),
  command("lease.create", "Lease target", "POST", "/device-leases", {
    confirmation: "confirm",
    input: leaseCreateInputParser,
    output: objectFieldParser("lease response", "lease"),
  }),
  command("lease.takeover", "Take over target lease", "POST", "/device-leases/:leaseId/takeover", {
    confirmation: "dangerous",
    input: leaseTakeoverInputParser,
    output: objectFieldParser("lease response", "lease"),
  }),
  command("lease.release", "Release target lease", "POST", "/device-leases/:leaseId/release", {
    output: objectFieldParser("lease response", "lease"),
  }),
  command("action.run", "Run action and wait", "POST", "/actions/:actionId/run", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  query("recipe.list", "List executable recipes", "/recipes", {
    category: "authoring",
    input: emptyInputParser,
    output: genericObjectOutputParser,
  }),
  query("recipe.get", "Get executable recipe", "/recipes/:recipeId", {
    category: "authoring",
    input: recipeRefParser,
    output: genericObjectOutputParser,
  }),
  command("recipe.create", "Create executable recipe", "POST", "/recipes", {
    category: "authoring",
    input: recipeWriteParser,
    output: genericObjectOutputParser,
  }),
  command("recipe.update", "Update executable recipe", "PUT", "/recipes/:recipeId", {
    category: "authoring",
    input: recipeWriteParser,
    output: genericObjectOutputParser,
  }),
  command("recipe.delete", "Delete executable recipe", "DELETE", "/recipes/:recipeId", {
    category: "authoring",
    confirmation: "confirm",
    input: recipeRefParser,
    output: okParser,
  }),
  query("recipe.yaml.get", "Get recipe YAML", "/recipes/:recipeId/yaml", {
    category: "authoring",
    input: recipeRefParser,
    output: genericObjectOutputParser,
  }),
  command("recipe.import", "Import recipe YAML", "POST", "/recipes/import", {
    category: "authoring",
    input: recipeImportParser,
    output: genericObjectOutputParser,
  }),
  command(
    "recipe.evidence.create",
    "Attach recipe evidence",
    "POST",
    "/recipes/:recipeId/evidence",
    {
      category: "evidence",
      input: recipeEvidenceParser,
      output: genericObjectOutputParser,
    },
  ),
  query("recipe.history.list", "List recipe history", "/recipes/:recipeId/history", {
    category: "authoring",
    input: recipeRefParser,
    output: genericObjectOutputParser,
  }),
  command(
    "recipe.history.restore",
    "Restore recipe history",
    "POST",
    "/recipes/:recipeId/history",
    {
      category: "authoring",
      confirmation: "confirm",
      input: recipeHistoryRestoreParser,
      output: genericObjectOutputParser,
    },
  ),
  query("recipe.stability.get", "Get recipe stability", "/recipes/:recipeId/stability", {
    category: "evidence",
    input: recipeRefParser,
    output: genericObjectOutputParser,
  }),
  query("workspace.variables.get", "Get project variables", "/project/variables", {
    input: emptyInputParser,
    output: revisionedVariablesParser,
  }),
  command("workspace.variables.update", "Update project variables", "PUT", "/project/variables", {
    output: revisionedVariablesParser,
  }),
  ...appMapOperationDefinitions,
  query("authoring.session.list", "List Authoring Sessions", "/authoring-sessions", {
    category: "authoring",
    input: authoringSessionListInputParser,
    output: authoringSessionListParser,
  }),
  query("authoring.session.get", "Get Authoring Session", "/authoring-sessions/:sessionId", {
    category: "authoring",
    input: authoringSessionRefParser,
    output: authoringSessionResponseParser,
  }),
  command("authoring.session.create", "Create Authoring Session", "POST", "/authoring-sessions", {
    category: "authoring",
    input: createAuthoringSessionParser,
    output: authoringSessionResponseParser,
    targetCapabilities: ["snapshot", "screenshot"],
    lease: "exclusive",
  }),
  command(
    "authoring.session.begin",
    "Create and Start Authoring Take",
    "POST",
    "/authoring-sessions/begin",
    {
      category: "authoring",
      input: createAuthoringSessionParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.observe",
    "Observe Authoring Target",
    "POST",
    "/authoring-sessions/:sessionId/observe",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.capture",
    "Capture Authoring Screen",
    "POST",
    "/authoring-sessions/:sessionId/capture",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.start",
    "Start Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/start",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.interact",
    "Interact During Authoring",
    "POST",
    "/authoring-sessions/:sessionId/interact",
    {
      category: "authoring",
      input: authoringInteractionParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["tap", "type", "scroll"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.stop",
    "Stop Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/stop",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.take.trim",
    "Trim Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/trim",
    {
      category: "authoring",
      input: trimAuthoringTakeParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.take.reorder",
    "Reorder Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/reorder",
    {
      category: "authoring",
      input: reorderAuthoringTakeParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.take.replace",
    "Replace Authoring Action",
    "POST",
    "/authoring-sessions/:sessionId/actions/:actionId",
    {
      category: "authoring",
      input: replaceAuthoringActionParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.take.replay",
    "Replay Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/replay",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["tap", "type", "scroll", "snapshot", "screenshot"],
      lease: "exclusive",
      progress: true,
      cancellable: true,
    },
  ),
  command(
    "authoring.session.commit",
    "Commit Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/commit",
    {
      category: "authoring",
      input: commitAuthoringSessionParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.session.discard",
    "Discard Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/discard",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.session.cancel",
    "Cancel Authoring Session",
    "POST",
    "/authoring-sessions/:sessionId/cancel",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.session.cleanup",
    "Remove Authoring Session",
    "DELETE",
    "/authoring-sessions/:sessionId",
    { category: "authoring", input: authoringSessionRefParser, output: okParser },
  ),
  query("schedule.list", "List schedules", "/schedules"),
  command("schedule.create", "Create schedule", "POST", "/schedules"),
  command("schedule.delete", "Delete schedule", "DELETE", "/schedules/:scheduleId"),
  query("matrix.list", "List compatibility matrices", "/matrices"),
  command("matrix.create", "Create compatibility matrix", "POST", "/matrices"),
  command("matrix.update", "Update compatibility matrix", "PUT", "/matrices/:matrixId"),
  command("matrix.delete", "Delete compatibility matrix", "DELETE", "/matrices/:matrixId"),
  command("matrix.import", "Import compatibility matrix", "POST", "/matrices/import"),
  command("matrix.resolve", "Resolve compatibility matrix", "POST", "/matrices/:matrixId/resolve", {
    idempotency: "inherent",
  }),
  ...discoveryOperationDefinitions,
  ...corpusOperationDefinitions,
  query("job.list", "List jobs", "/jobs", { category: "execution", output: jobsParser }),
  query("job.get", "Get job", "/jobs/:jobId", { category: "execution", input: jobIdInputParser }),
  command("job.start", "Start job", "POST", "/jobs", {
    category: "execution",
    input: startJobInputParser,
    progress: true,
    cancellable: true,
  }),
  command("job.retry", "Retry job", "POST", "/jobs/:jobId/retry", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command("run.replay", "Replay recorded run", "POST", "/runs/:runId/replay", {
    category: "execution",
    input: runIdInputParser,
    progress: true,
    cancellable: true,
  }),
  command("job.cancel", "Cancel job", "POST", "/jobs/:jobId/cancel", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.pause", "Pause job", "POST", "/jobs/:jobId/pause", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.resume", "Resume job", "POST", "/jobs/:jobId/resume", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.active.cancel", "Cancel active job", "POST", "/jobs/active/cancel", {
    category: "execution",
    idempotency: "inherent",
  }),
  command("job.matrix.start", "Run job matrix", "POST", "/jobs/matrix", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command(
    "job.locale-matrix.start",
    "Run a map path across locales",
    "POST",
    "/jobs/locale-matrix",
    {
      category: "execution",
      progress: true,
      cancellable: true,
      lease: "exclusive",
      targetCapabilities: ["tap", "snapshot", "screenshot", "launch"],
    },
  ),
  query(
    "job.locale-matrix.export",
    "Export locale-run screenshot pack",
    "/jobs/locale-matrix/:batchId/export",
    { category: "execution" },
  ),
  query("job.locale-matrix.analysis", "Locale findings", "/jobs/locale-matrix/:batchId/analysis", {
    category: "execution",
  }),
  command(
    "job.locale-matrix.infer",
    "Infer locale options from taught live-screen rows",
    "POST",
    "/jobs/locale-matrix/infer",
    { category: "execution" },
  ),
  ...combineOperationDefinitions,
  command(
    "job.compatibility-matrix.start",
    "Run compatibility matrix",
    "POST",
    "/jobs/compatibility-matrix",
    {
      category: "execution",
      progress: true,
      cancellable: true,
    },
  ),
  command("job.soak.start", "Start soak run", "POST", "/jobs/soak", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  query("run.list", "List Runs", "/runs", {
    category: "execution",
    input: runListInputParser,
    output: runsParser,
  }),
  query("run.get", "Get Run", "/runs/:runId", {
    category: "evidence",
    input: runIdInputParser,
  }),
  query("run.replay.offline", "Replay Run Offline", "/runs/:runId/replay-offline", {
    category: "evidence",
    input: runIdInputParser,
    output: offlineRunReplayOutputParser,
  }),
  ...runRepairOperationDefinitions,
  command("run.review", "Review a deferred run check", "POST", "/runs/:runId/review", {
    category: "evidence",
    confirmation: "confirm",
    input: runReviewInputParser,
    output: runReviewOutputParser,
  }),
  query("run.evidence.get", "Get Run Evidence", "/runs/:runId/evidence", {
    category: "evidence",
    input: runEvidenceInputParser,
  }),
  query("run.story.get", "Get Run story", "/runs/:runId/story", {
    category: "evidence",
    input: runIdInputParser,
  }),
  ...runShareOperationDefinitions,
  command("run.catalog.rebuild", "Rebuild Run catalog", "POST", "/runs/catalog/rebuild", {
    category: "execution",
    confirmation: "confirm",
  }),
  command("run.retention.apply", "Apply Run retention", "POST", "/runs/retention", {
    category: "execution",
    confirmation: "dangerous",
  }),
  command(
    "run.visual-baseline.update",
    "Explicitly approve visual baseline",
    "POST",
    "/runs/:runId/visual-baseline",
    {
      category: "evidence",
      confirmation: "confirm",
      input: visualBaselineInputParser,
      output: visualBaselineOutputParser,
    },
  ),
  command(
    "run.visual.compare",
    "Compare Run with approved visual baseline",
    "POST",
    "/runs/:runId/visual-comparison",
    {
      category: "evidence",
      input: visualCompareInputParser,
      output: visualComparisonOutputParser,
    },
  ),
  command("run.visual.review", "Review visual comparison", "POST", "/runs/:runId/visual-review", {
    category: "evidence",
    confirmation: "confirm",
    input: visualReviewInputParser,
    output: visualReviewOutputParser,
  }),
  query("run.visual-policy.get", "Get visual comparison policy", "/runs/:runId/visual-policy", {
    category: "evidence",
    input: visualPolicyGetInputParser,
    output: visualPolicyOutputParser,
  }),
  command(
    "run.visual-policy.update",
    "Update visual comparison policy",
    "PUT",
    "/runs/:runId/visual-policy",
    {
      category: "evidence",
      confirmation: "confirm",
      input: visualPolicyUpdateInputParser,
      output: visualPolicyUpdateOutputParser,
    },
  ),
  command("run.pin.update", "Pin Run", "POST", "/runs/:runId/pin", { category: "execution" }),
  command("step.run", "Run one recipe step", "POST", "/step/run", {
    category: "execution",
    targetCapabilities: ["snapshot", "tap", "type", "scroll"],
    lease: "exclusive",
    progress: true,
    cancellable: true,
    input: targetInputParser,
    output: stepRunOutputParser,
  }),
  command("generation.create", "Generate test data", "POST", "/generate", {
    category: "authoring",
    input: generationInputParser,
    output: generationOutputParser,
  }),
] as const satisfies readonly OperationDefinition<OperationId>[];

export function operationDefinition<Id extends OperationId>(
  id: Id,
): OperationDefinition<Id, OperationInput<Id>, OperationOutput<Id>> {
  const definition = operationDefinitions.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown operation: ${id}`);
  return definition as OperationDefinition<Id, OperationInput<Id>, OperationOutput<Id>>;
}

export function validateOperationDefinitions(
  definitions: readonly OperationDefinition[] = operationDefinitions,
): void {
  const ids = new Set<string>();
  const transports = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate operation id: ${definition.id}`);
    ids.add(definition.id);
    const route = `${definition.transport.method} ${definition.transport.path}`;
    if (transports.has(route)) throw new Error(`Duplicate operation transport: ${route}`);
    transports.add(route);
    if (definition.version !== 1) throw new Error(`${definition.id} has an unsupported version`);
    if (!definition.label.trim()) throw new Error(`${definition.id} is missing a label`);
    if (!projectRoles.includes(definition.minimumRole)) {
      throw new Error(`${definition.id} has an unsupported minimum role`);
    }
    if (definition.cancellable && !definition.progress) {
      throw new Error(`${definition.id} is cancellable but does not report progress`);
    }
    if (definition.mode === "query" && definition.confirmation !== "none") {
      throw new Error(`${definition.id} is a query that requires confirmation`);
    }
    if (definition.lease !== "none" && definition.targetCapabilities.length === 0) {
      throw new Error(`${definition.id} requires a lease without a target capability`);
    }
  }
}

export type OperationManifestItem = Omit<OperationDefinition, "input" | "output"> & {
  input: string;
  output: string;
};

export function operationManifest(
  definitions: readonly OperationDefinition[] = operationDefinitions,
): OperationManifestItem[] {
  validateOperationDefinitions(definitions);
  return definitions.map(({ input, output, ...definition }) => ({
    ...definition,
    input: input.description,
    output: output.description,
  }));
}
