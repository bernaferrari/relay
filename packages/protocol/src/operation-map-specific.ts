/**
 * The concrete operation-to-input/output map.
 *
 * Keeping the large map type separate from the DTO definitions keeps the
 * canonical operation surface navigable without changing its public shape.
 */
import type {
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
import type { TargetRuntimeReadiness } from "./target-contract.js";
import type { RunReview } from "./run-review.js";
import type {
  CaptureReviewAction,
  CaptureReviewDecision,
  CaptureReviewQueue,
} from "./capture-review.js";
import type { CampaignRepairOperationMap } from "./run-repair-operations.js";
import type { RunShareOperationMap } from "./run-share.js";
import type { CaptureReferenceOperationMap } from "./capture-reference-operations.js";
import type { TracePackExportResponse } from "./trace-pack.js";
import type { WalkthroughPackExportResponse } from "./walkthrough-pack.js";
import type { RunPanelManifest } from "./run-panel-manifest.js";
import type {
  LocalCampaignAdmissionPreflightRequest,
  LocalCampaignAdmissionPreflightResponse,
} from "./combine-campaign.js";
import type { ActivityExport } from "./activity.js";
import type { AppMapOperationMap } from "./app-map-operation-map.js";
import type { OperationRecord } from "./operation-contract.js";
import type { ExecutionTargetRef } from "./execution-target.js";
import type { TargetObservation } from "./target-observation.js";
import type {
  TargetInputManualReview,
  TargetInputReconciliationOutcome,
  TargetSupervisorHealth,
} from "./target-supervisor.js";
import type { WorkflowOperationMap } from "./workflow-record.js";
import type { WorkspaceChangeContext } from "./workspace-change-context.js";
import type { ProofOperationMap } from "./proof-operation-map.js";
import type { AndroidAvdBootResult, AndroidAvdInventory } from "./target-contract.js";
import type {
  ActionSummary,
  BuildDto,
  DeviceLeaseDto,
  DevicePoolDto,
  DeviceSummary,
  DurableRecoveryFenceReleaseDto,
  EvidenceCollectionPolicyDto,
  GenerationRequestDto,
  GenerationResultDto,
  HealthSummary,
  JobSummaryDto,
  ProjectDto,
  RedactionPolicyDto,
  RevisionWriteDto,
  RevisionedDto,
  RunSummaryDto,
  SensitiveEvidenceChannelDto,
  ScrollSurveyNodeDto,
  ScrollSurveySnapshotDto,
  ScrollSurveyStopReasonDto,
  StepRunResult,
  TargetScreenshotDto,
  TargetSnapshotDto,
  TestDataDto,
} from "./operation-map.js";

export type SpecificOperationMap = {
  "system.health.get": { input: Record<string, never>; output: HealthSummary };
  "event.stream": { input: Record<string, never>; output: EventEnvelope };
  "activity.export": {
    input: Record<string, never>;
    output: { export: ActivityExport };
  };
  "workspace.change.inspect": {
    input: { baseRef?: string };
    output: { change: WorkspaceChangeContext };
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
  "target.devices.list": {
    input: { phase?: "android" | "ios"; targetKind?: "device" | "browser"; targetId?: string };
    output: { devices: DeviceSummary[] };
  };
  "target.avds.list": {
    input: Record<string, never>;
    output: { inventory: AndroidAvdInventory };
  };
  "target.avd.boot": {
    input: { avdName: string; timeoutMs?: number; headless?: boolean };
    output: { boot: AndroidAvdBootResult };
  };
  "target.health.get": {
    input: { serial: string };
    output: { health: TargetSupervisorHealth };
  };
  "target.input.reconcile": {
    input: {
      serial: string;
      mutationId: string;
      resolutionId?: string;
      outcome: "applied" | "not-applied" | "ambiguous";
      /** A person looked at the screen: resolve the input pending on this
       * target even if its id differs from mutationId (for example an input
       * interrupted by a restart, whose id the client never learned). */
      reconcilePending?: boolean;
      /** Explicitly review this exact legacy client-only Android mutation.
       * Requires no server pending input; never retargets another mutation. */
      clientUnknown?: boolean;
    };
    output: {
      health: TargetSupervisorHealth;
      observation: TargetObservation;
      mutationId?: string;
      outcome?: TargetInputReconciliationOutcome;
      review?: TargetInputManualReview;
      resolutionId?: string;
    };
  };
  "target.input.receipt.get": {
    input: { serial: string; mutationId?: string; resolutionId?: string };
    output: {
      receipt: {
        resolutionId: string;
        mutationId: string;
        outcome: TargetInputReconciliationOutcome;
        review?: TargetInputManualReview;
        reviewedAt: number;
        health?: {
          state: "ready" | "blocked" | "uncertain";
          pendingMutationId?: string;
          reason?: string;
        };
        observation?: unknown;
      };
    };
  };
  "target.snapshot.capture": {
    input: {
      serial?: string;
      laneId?: string;
      visual?: boolean;
      full?: boolean;
      interactiveOnly?: boolean;
    };
    output: TargetSnapshotDto;
  };
  "target.screenshot.capture": {
    input: {
      serial: string;
      previewX?: number;
      previewY?: number;
      caption?: string;
      jobId?: string;
      ephemeral?: boolean;
    };
    output: TargetScreenshotDto;
  };
  "target.observation.capture": {
    input: { serial: string };
    output: TargetObservation;
  };
  "step.run": { input: { step: RecipeStep; serial: string }; output: StepRunResult };
  "target.scroll-survey.capture": {
    input: {
      serial: string;
      maxScrolls?: number;
      restore?: boolean;
      dir?: string;
      force?: boolean;
    };

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
      persist?: {
        dir: string;
        status: "completed" | "stopped";
        reason: string;
        frameCount: number;
        paths: Array<{ png: string; json: string }>;
        frames: Array<{
          index: number;
          offsetY?: number;
          labelCount: number;
          files: { png: string; json: string };
        }>;
        full?: {
          png: string;
          json: string;
          width: number;
          height: number;
          nodeCount: number;
        };
      };
    };
  };
  "target.app.launch": {
    input: { serial: string; app: string; relaunch?: boolean };
    output: {
      launched: {
        serial: string;
        app: string;
        platform: "android" | "ios" | "browser";
        launchedAt: number;
      };
      observed: {
        app?: string;
        matched: boolean;
      };
    };
  };
  "target.app.locales": {
    input: { serial: string; package: string };
    output: {
      packageName: string;
      locales: string[];
      currentLocale?: string;
      source?: "android-locale-manager" | "android-device-locale";
    };
  };
  "target.app.list": {
    input: { serial: string };
    output: { apps: Array<{ package: string; name: string }> };
  };
  "target.app.locale.set": {
    input: { serial: string; package: string; locale: string };
    output: { packageName: string; locale: string; observedLocale?: string };
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
      /** Admin-only recovery; uncertain input still requires reconciliation. */
      force?: boolean;
      reason?: "connect" | "observe" | "control" | "record" | "auto";
      /** Optional, local-only request to release one interrupted durable
       * assignment after Relay captures a fresh pixel/semantic/pixel proof. */
      recoveryFenceAssignmentId?: string;
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
      recoveryFenceRelease?: DurableRecoveryFenceReleaseDto;
    };
  };
  "job.list": {
    input: { limit?: number };
    output: { jobs: JobSummaryDto[]; active?: JobSummaryDto | null };
  };
  "job.get": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.start": {
    input: {
      recipe: string;
      serial?: string;
      /** Explicit immutable target identity. Remote provider sessions are
       * admitted only when the server host has registered their driver. */
      executionTarget?: ExecutionTargetRef;
      [key: string]: unknown;
    };
    output: { job: OperationRecord };
  };
  "run.replay": {
    input: { runId: string; mode?: "saved-steps" | "same-configuration" };
    output: { job: OperationRecord };
  };
  "job.cancel": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.pause": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.resume": { input: { jobId: string }; output: { job: OperationRecord } };
  "run.list": {
    input: {
      limit?: number;
      appMapId?: string;
      cursor?: string;
      /** Only each saved Test's newest run, from the whole history. */
      latestPerTest?: boolean;
    };
    output: { runs: RunSummaryDto[]; totalCount?: number; nextCursor?: string };
  };
  "run.get": { input: { runId: string }; output: { run: OperationRecord } };
  "run.panel-manifest.get": {
    input: { runId: string; offset?: number; limit?: number };
    output: { manifest: RunPanelManifest };
  };
  "run.replay.offline": {
    input: { runId: string };
    output: { report: OperationRecord };
  };
  "run.trace-pack.get": {
    input: { runId: string };
    output: TracePackExportResponse;
  };
  "run.walkthrough-pack.get": {
    input: { runId: string; with?: string | readonly string[] };
    output: WalkthroughPackExportResponse;
  };
  "run.review": {
    input: { runId: string; action: "approve" | "reject" | "defer"; note?: string };
    output: { run: OperationRecord; review: RunReview };
  };
  "run.evidence.get": {
    input: { runId: string; limit?: number; includeBodies?: boolean; testStepId?: string };
    output: { evidence: OperationRecord };
  };
  "run.story.get": { input: { runId: string }; output: { story: OperationRecord } };
  "run.visual.compare": { input: { runId: string }; output: { comparison: VisualComparison } };
  "run.visual.review": {
    input: { runId: string; comparisonId: string; action: VisualReviewAction; note?: string };
    output: { decision: VisualReviewDecision; baseline: VisualBaseline | null };
  };
  "run.capture.review": {
    input: {
      runId: string;
      captureId: string;
      action: CaptureReviewAction;
      imageSha256?: string;
      note?: string;
      expectedReviewVersion?: number;
    };
    output: {
      run: OperationRecord;
      queue: CaptureReviewQueue;
      decision: CaptureReviewDecision;
      referenceUpdate?: {
        status: "updated" | "revoked" | "unchanged" | "failed";
        message?: string;
      };
    };
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
      /** Archived sessions contain immutable audit evidence and are returned
       * only when a caller explicitly asks for history. */
      includeHistory?: boolean;
      /** Lists only need where each Take stands now: keep the current
       * revision and its latest replay, drop the earlier snapshots. */
      latestRevisionOnly?: boolean;
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
  "authoring.take.optimization.get": {
    input: { sessionId: string };
    output: AuthoringRawOptimizationProposalResponse;
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
  "authoring.take.edit": {
    input: EditAuthoringTakeInput;
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
  "campaign.duration.cohorts.estimate": {
    input: CampaignCapacityCohortDurationEstimateRequest;
    output: CampaignCapacityCohortDurationEstimateResponse;
  };
  "campaign.local-admission.preflight": {
    input: LocalCampaignAdmissionPreflightRequest;
    output: LocalCampaignAdmissionPreflightResponse;
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
  RunShareOperationMap &
  CaptureReferenceOperationMap &
  WorkflowOperationMap &
  ProofOperationMap;
