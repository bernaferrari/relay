// Keep the operation contract at the bottom of the protocol dependency graph.
// In particular, do not import from `index.ts`: it re-exports this module and
// doing so creates a public-barrel cycle. These transport DTOs intentionally
// describe only the stable wire fields needed by every host.
import {
  assertAuthoringSessionRef,
  parseAuthoringSessionListResponse,
  parseAuthoringSessionResponse,
  type AuthoringInteraction,
  type AuthoringSessionListResponse,
  type AuthoringSessionResponse,
  type AuthoringTarget,
  type CommitAuthoringSessionInput,
  type CreateAuthoringSessionInput,
  type ReorderAuthoringTakeInput,
  type ReplaceAuthoringActionInput,
  type TrimAuthoringTakeInput,
} from "./authoring.js";
import type {
  AppMap,
  AppMapBatchChange,
  AppMapCompiledConnectionRun,
  AppMapCompiledFlow,
  AppMapPatch,
  CaseStack,
  AppMapVariable,
  AppMapTest,
  AppMapCombine,
  AppMapCombinePreflight,
  CreateConnectionInput,
  CreateScreenInput,
  ConnectionPatch,
  MapGroup,
  Proposal,
  SaveFlowInput,
  SaveRoutineInput,
  Screen,
  ScreenIdentityObservation,
  ScreenVariant,
  UpdateScreenInput,
} from "./app-map.js";
import type { AppMapCompiledTest, AppMapScenarioTestEdit } from "./test-intent.js";
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
import type { RunReview } from "./run-review.js";
import { runShareOperationDefinitions, type RunShareOperationMap } from "./run-share.js";
import { parseActivityExportResponse, type ActivityExport } from "./activity.js";
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

export type OperationMode = "query" | "command" | "stream";
export type OperationIdempotency = "none" | "optional" | "required" | "inherent";
export type OperationConfirmation = "none" | "confirm" | "dangerous";
export const projectRoles = ["viewer", "author", "runner", "admin"] as const;
export type ProjectRole = (typeof projectRoles)[number];

const projectRoleRank: Record<ProjectRole, number> = {
  viewer: 0,
  author: 1,
  runner: 2,
  admin: 3,
};

export function projectRoleAllows(actual: ProjectRole, required: ProjectRole): boolean {
  return projectRoleRank[actual] >= projectRoleRank[required];
}

export type OperationCategory =
  | "system"
  | "target"
  | "authoring"
  | "execution"
  | "evidence"
  | "workspace"
  | "discovery"
  | "corpus";

export type RuntimeParser<T> = {
  readonly description: string;
  parse(value: unknown): T;
};

export type OperationTransport = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
};

export type OperationDefinition<Id extends string = string, Input = unknown, Output = unknown> = {
  id: Id;
  version: 1;
  label: string;
  category: OperationCategory;
  mode: OperationMode;
  input: RuntimeParser<Input>;
  output: RuntimeParser<Output>;
  idempotency: OperationIdempotency;
  targetCapabilities: readonly string[];
  lease: "none" | "shared" | "exclusive";
  confirmation: OperationConfirmation;
  /** Lowest project role allowed to invoke this operation. */
  minimumRole: ProjectRole;
  progress: boolean;
  cancellable: boolean;
  transport: OperationTransport;
};

export type OperationRecord = Record<string, unknown>;

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
    output: { nodes: unknown[]; interactive: unknown[]; tree: string };
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
    };
  };
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
  "run.review": {
    input: { runId: string; action: "approve" | "reject"; note?: string };
    output: { run: OperationRecord; review: RunReview };
  };
  "run.evidence.get": {
    input: { runId: string; limit?: number; includeBodies?: boolean };
    output: { evidence: OperationRecord };
  };
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
  "app-map.list": { input: Record<string, never>; output: { appMaps: AppMap[] } };
  "app-map.get": { input: { appMapId: string }; output: { appMap: AppMap } };
  "app-map.remove": { input: { appMapId: string }; output: { ok: true } };
  "app-map.create": {
    input: { appMapId: string; name: string };
    output: { appMap: AppMap };
  };
  "app-map.duplicate": {
    input: { sourceAppMapId: string; appMapId: string; name?: string };
    output: { appMap: AppMap };
  };
  "app-map.export": {
    input: { appMapId: string };
    output: { appMap: AppMap; yaml: string; filename: string };
  };
  "app-map.import": {
    input: {
      yaml: string;
      dryRun?: boolean;
      conflict?: "reject" | "replace" | "copy";
    };
    output: { appMap: AppMap; imported: boolean };
  };
  "app-map.update": {
    input: { appMapId: string; expectedRevision: number; eventId?: string; patch: AppMapPatch };
    output: { appMap: AppMap };
  };
  "app-map.commit": {
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      summary?: string;
      changes: AppMapBatchChange[];
      patch?: AppMapPatch;
    };
    output: { appMap: AppMap };
  };
  "app-map.screen.add": {
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      screen: CreateScreenInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.screen.capture": {
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      target: AuthoringTarget;
      leaseId: string;
      title?: string;
      position?: { x: number; y: number };
    };
    output: {
      appMapId: string;
      appMapRevision: number;
      screen: Screen;
      variant: ScreenVariant;
      created: boolean;
      /** A changed semantic capture is pending human comparison; the map still
       * renders its prior approved variant until this proposal is accepted. */
      reviewProposalId?: string;
    };
  };
  "app-map.teach": {
    input: {
      appMapId: string;
      expectedRevision?: number;
      eventId?: string;
      target: AuthoringTarget;
      leaseId: string;
      fromScreenId?: string;
      title?: string;
      label?: string;
      interaction?:
        | { kind: "point"; x: number; y: number }
        | { kind: "label"; label: string; point?: { x: number; y: number } }
        | { kind: "identifier"; identifier: string; point?: { x: number; y: number } }
        | {
            kind: "swipe";
            from: { x: number; y: number };
            to: { x: number; y: number };
            durationMs?: number;
          };
    };
    output: {
      appMapId: string;
      appMapRevision: number;
      screen: Screen;
      variant: ScreenVariant;
      created: boolean;
      connectionId?: string;
      reviewProposalId?: string;
    };
  };
  "app-map.screen.update": {
    input: {
      appMapId: string;
      screenId: string;
      expectedRevision: number;
      eventId?: string;
      input: UpdateScreenInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.screen.remove": {
    input: { appMapId: string; screenId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.connection.create": {
    input: {
      appMapId: string;
      expectedRevision: number;
      eventId?: string;
      connection: CreateConnectionInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.connection.update": {
    input: {
      appMapId: string;
      connectionId: string;
      expectedRevision: number;
      eventId?: string;
      patch: ConnectionPatch;
    };
    output: { appMap: AppMap };
  };
  "app-map.connection.remove": {
    input: { appMapId: string; connectionId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.connection.run": {
    input: {
      appMapId: string;
      connectionId: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      variables?: Record<string, string | string[]>;
    };
    output: {
      job: OperationRecord;
      jobs: OperationRecord[];
      plan: AppMapCompiledConnectionRun;
      matrix?: {
        id: string;
        createdAt: number;
        seed: number;
        strategy: "repeat" | "zip" | "cartesian" | "pairwise";
        cases: Array<{
          id: string;
          name: string;
          index: number;
          values: Record<string, string>;
          provenance: unknown[];
        }>;
      };
    };
  };
  "app-map.group.save": {
    input: {
      appMapId: string;
      groupId: string;
      expectedRevision: number;
      eventId?: string;
      group: MapGroup;
    };
    output: { appMap: AppMap };
  };
  "app-map.group.remove": {
    input: { appMapId: string; groupId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.flow.save": {
    input: {
      appMapId: string;
      flowId: string;
      expectedRevision: number;
      eventId?: string;
      flow: SaveFlowInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.flow.remove": {
    input: { appMapId: string; flowId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.flow.run": {
    input: {
      appMapId: string;
      flowId: string;
      throughConnectionId?: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      variables?: Record<string, string | string[]>;
    };
    output: {
      job: OperationRecord;
      jobs: OperationRecord[];
      plan: AppMapCompiledFlow;
      matrix?: {
        id: string;
        createdAt: number;
        seed: number;
        strategy: "repeat" | "zip" | "cartesian" | "pairwise";
        cases: Array<{
          id: string;
          name: string;
          index: number;
          values: Record<string, string>;
          provenance: unknown[];
        }>;
      };
    };
  };
  "app-map.case-stack.save": {
    input: {
      appMapId: string;
      caseStackId: string;
      expectedRevision: number;
      eventId?: string;
      caseStack: CaseStack;
    };
    output: { appMap: AppMap };
  };
  "app-map.case-stack.attach": {
    input: {
      appMapId: string;
      connectionId: string;
      caseStackId: string;
      expectedRevision: number;
      eventId?: string;
      caseStack?: CaseStack;
    };
    output: { appMap: AppMap };
  };
  "app-map.case-stack.remove": {
    input: {
      appMapId: string;
      caseStackId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.variable.save": {
    input: {
      appMapId: string;
      variableId: string;
      expectedRevision: number;
      eventId?: string;
      variable: AppMapVariable;
    };
    output: { appMap: AppMap };
  };
  "app-map.variable.remove": {
    input: {
      appMapId: string;
      variableId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.save": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
      test: AppMapTest;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.remove": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.test.edit": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
      edits: AppMapScenarioTestEdit[];
    };
    output: { appMap: AppMap };
  };
  "app-map.test.propose": {
    input: {
      appMapId: string;
      testId: string;
      expectedRevision: number;
      eventId?: string;
      proposalId?: string;
      title?: string;
      description?: string;
      edits: AppMapScenarioTestEdit[];
    };
    output: { appMap: AppMap; proposalId: string };
  };
  "app-map.test.compile": {
    input: { appMapId: string; testId: string };
    output: { plan: AppMapCompiledTest };
  };
  "app-map.combine.save": {
    input: {
      appMapId: string;
      combineId: string;
      expectedRevision: number;
      eventId?: string;
      combine: AppMapCombine;
    };
    output: { appMap: AppMap };
  };
  "app-map.combine.preflight": {
    input: {
      appMapId: string;
      combineId: string;
      serial?: string;
    };
    output: { preflight: AppMapCombinePreflight };
  };
  "app-map.combine.remove": {
    input: {
      appMapId: string;
      combineId: string;
      expectedRevision: number;
      eventId?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.routine.save": {
    input: {
      appMapId: string;
      routineId: string;
      expectedRevision: number;
      eventId?: string;
      routine: SaveRoutineInput;
    };
    output: { appMap: AppMap };
  };
  "app-map.routine.remove": {
    input: { appMapId: string; routineId: string; expectedRevision: number; eventId?: string };
    output: { appMap: AppMap };
  };
  "app-map.proposal.submit": {
    input: { appMapId: string; expectedRevision: number; eventId?: string; proposal: Proposal };
    output: { appMap: AppMap };
  };
  "app-map.observations.propose": {
    input: {
      appMapId: string;
      sessionId: string;
      expectedRevision: number;
      proposalId?: string;
      title?: string;
      transitionIds?: string[];
      eventId?: string;
    };
    output: { appMap: AppMap; proposalId: string };
  };
  "app-map.proposal.approve": {
    input: {
      appMapId: string;
      proposalId: string;
      expectedRevision: number;
      eventId?: string;
      reason?: string;
    };
    output: { appMap: AppMap };
  };
  "app-map.proposal.reject": {
    input: {
      appMapId: string;
      proposalId: string;
      expectedRevision: number;
      eventId?: string;
      reason?: string;
    };
    output: { appMap: AppMap };
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
} & RunShareOperationMap;

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
  | "discovery.suggestion"
  | "discovery.coverage"
  | "discovery.export"
  | "discovery.promote"
  | "corpus.list"
  | "corpus.create"
  | "corpus.get"
  | "corpus.rename"
  | "corpus.status.update"
  | "corpus.start"
  | "corpus.cancel"
  | "corpus.coverage"
  | "corpus.analysis"
  | "corpus.export"
  | "job.locale-matrix.start"
  | "job.locale-matrix.export"
  | "job.locale-matrix.infer"
  | "job.combine.start"
  | "job.combine.export"
  | "job.combine.infer"
  | "corpus.screen.get"
  | "language-profile.list"
  | "language-profile.scan"
  | "language-profile.save"
  | "switcher-profile.list"
  | "switcher-profile.scan"
  | "switcher-profile.save"
  | "job.retry"
  | "run.replay"
  | "job.active.cancel"
  | "job.matrix.start"
  | "job.compatibility-matrix.start"
  | "job.soak.start"
  | "run.catalog.rebuild"
  | "run.retention.apply"
  | "run.pin.update"
  | "step.run";

type GenericOperationMap = {
  [Id in GenericOperationId]: { input: OperationRecord; output: OperationRecord };
};

export type RelayOperationMap = SpecificOperationMap & GenericOperationMap;
export type OperationId = keyof RelayOperationMap;
export type OperationInput<Id extends OperationId> = RelayOperationMap[Id]["input"];
export type OperationOutput<Id extends OperationId> = RelayOperationMap[Id]["output"];

function fail(label: string, message: string): never {
  throw new Error(`${label} ${message}`);
}

function record(value: unknown, label: string): OperationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(label, "must be an object");
  }
  return value as OperationRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) return fail(label, "must be a non-empty string");
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fail(label, "must be a number");
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return fail(label, "must be a boolean");
  return value;
}

export const operationRecordParser: RuntimeParser<OperationRecord> = {
  description: "JSON object",
  parse(value) {
    return record(value, "operation value");
  },
};

const emptyInputParser: RuntimeParser<Record<string, never>> = {
  description: "empty object",
  parse(value) {
    const input = record(value, "operation input");
    if (Object.keys(input).length) fail("operation input", "must be empty");
    return {};
  },
};

function objectParser<T extends OperationRecord>(
  description: string,
  validate?: (input: OperationRecord) => void,
): RuntimeParser<T> {
  return {
    description,
    parse(value) {
      const input = record(value, description);
      validate?.(input);
      return input as T;
    },
  };
}

function arrayFieldParser<T extends OperationRecord>(
  description: string,
  field: string,
): RuntimeParser<T> {
  return objectParser<T>(description, (input) => {
    if (!Array.isArray(input[field])) fail(`${description} ${field}`, "must be an array");
  });
}

function objectFieldParser<T extends OperationRecord>(
  description: string,
  field: string,
): RuntimeParser<T> {
  return objectParser<T>(description, (input) => record(input[field], `${description} ${field}`));
}

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

const devicesParser = objectParser<{ devices: DeviceSummary[] }>("devices response", (input) => {
  if (!Array.isArray(input.devices)) fail("devices", "must be an array");
  for (const item of input.devices) {
    const device = record(item, "device");
    string(device.id, "device id");
    string(device.serial, "device serial");
    string(device.name, "device name");
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
        input.maxScrolls > 6)
    ) {
      fail("scroll survey maxScrolls", "must be an integer between 1 and 6");
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

const appMapRefParser = objectParser<{ appMapId: string }>("App Map reference", (input) => {
  string(input.appMapId, "App Map id");
});

const appMapCreateParser = objectParser<OperationInput<"app-map.create">>(
  "App Map creation",
  (input) => {
    string(input.appMapId, "App Map id");
    string(input.name, "App Map name");
  },
);

const appMapDuplicateParser = objectParser<OperationInput<"app-map.duplicate">>(
  "App Map duplication",
  (input) => {
    string(input.sourceAppMapId, "Source App Map id");
    string(input.appMapId, "Duplicate App Map id");
    if (input.name !== undefined) string(input.name, "Duplicate App Map name");
  },
);

const appMapImportParser = objectParser<OperationInput<"app-map.import">>(
  "App Map import",
  (input) => {
    string(input.yaml, "App Map YAML");
    if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") {
      fail("App Map import dryRun", "must be boolean");
    }
    if (
      input.conflict !== undefined &&
      input.conflict !== "reject" &&
      input.conflict !== "replace" &&
      input.conflict !== "copy"
    ) {
      fail("App Map import conflict", "must be reject, replace, or copy");
    }
  },
);

const appMapExportParser = objectParser<OperationOutput<"app-map.export">>(
  "App Map export response",
  (input) => {
    record(input.appMap, "exported App Map");
    string(input.yaml, "exported App Map YAML");
    string(input.filename, "exported App Map filename");
  },
);

const appMapImportOutputParser = objectParser<OperationOutput<"app-map.import">>(
  "App Map import response",
  (input) => {
    record(input.appMap, "imported App Map");
    if (typeof input.imported !== "boolean") fail("App Map imported", "must be boolean");
  },
);

const appMapFlowRunParser = objectParser<OperationInput<"app-map.flow.run">>(
  "App Map flow run input",
  (input) => {
    string(input.appMapId, "App Map flow run appMapId");
    string(input.flowId, "App Map flow run flowId");
    if (input.throughConnectionId !== undefined) {
      string(input.throughConnectionId, "App Map flow run throughConnectionId");
    }
    if (input.serial !== undefined) string(input.serial, "App Map flow run serial");
    if (input.browserTargetId !== undefined) {
      string(input.browserTargetId, "App Map flow run browserTargetId");
    }
    if (input.platform !== undefined && input.platform !== "android" && input.platform !== "ios") {
      fail("App Map flow run platform", "must be android or ios");
    }
    if (
      input.targetKind !== undefined &&
      input.targetKind !== "device" &&
      input.targetKind !== "browser"
    ) {
      fail("App Map flow run targetKind", "must be device or browser");
    }
    if (input.variables !== undefined) {
      for (const [name, value] of Object.entries(record(input.variables, "App Map variables"))) {
        if (Array.isArray(value)) {
          value.forEach((item) => string(item, `App Map variable ${name}`));
        } else {
          string(value, `App Map variable ${name}`);
        }
      }
    }
  },
);

const appMapFlowRunOutputParser = objectParser<OperationOutput<"app-map.flow.run">>(
  "App Map flow run response",
  (input) => {
    record(input.job, "App Map flow run job");
    if (!Array.isArray(input.jobs)) fail("App Map flow run jobs", "must be an array");
    record(input.plan, "App Map flow run plan");
    if (input.matrix !== undefined) record(input.matrix, "App Map flow run matrix");
  },
);

const appMapConnectionRunParser = objectParser<OperationInput<"app-map.connection.run">>(
  "App Map connection run input",
  (input) => {
    string(input.appMapId, "App Map connection run appMapId");
    string(input.connectionId, "App Map connection run connectionId");
    if (input.serial !== undefined) string(input.serial, "App Map connection run serial");
    if (input.browserTargetId !== undefined) {
      string(input.browserTargetId, "App Map connection run browserTargetId");
    }
    if (input.platform !== undefined && input.platform !== "android" && input.platform !== "ios") {
      fail("App Map connection run platform", "must be android or ios");
    }
    if (
      input.targetKind !== undefined &&
      input.targetKind !== "device" &&
      input.targetKind !== "browser"
    ) {
      fail("App Map connection run targetKind", "must be device or browser");
    }
    if (input.variables !== undefined) {
      for (const [name, value] of Object.entries(record(input.variables, "App Map variables"))) {
        if (Array.isArray(value)) {
          value.forEach((item) => string(item, `App Map variable ${name}`));
        } else {
          string(value, `App Map variable ${name}`);
        }
      }
    }
  },
);

const appMapConnectionRunOutputParser = objectParser<OperationOutput<"app-map.connection.run">>(
  "App Map connection run response",
  (input) => {
    record(input.job, "App Map connection run job");
    if (!Array.isArray(input.jobs)) fail("App Map connection run jobs", "must be an array");
    record(input.plan, "App Map connection run plan");
    if (input.matrix !== undefined) record(input.matrix, "App Map connection run matrix");
  },
);

function appMapMutationParser<Id extends OperationId>(
  description: string,
  nested?: string,
  requiredIds: readonly string[] = [],
): RuntimeParser<OperationInput<Id>> {
  return objectParser<OperationInput<Id>>(description, (input) => {
    string(input.appMapId, `${description} appMapId`);
    number(input.expectedRevision, `${description} expectedRevision`);
    if (input.eventId !== undefined) string(input.eventId, `${description} eventId`);
    for (const field of requiredIds) string(input[field], `${description} ${field}`);
    if (nested) record(input[nested], `${description} ${nested}`);
  });
}

function validateAppMapTestEdits(input: Record<string, unknown>, label: string): void {
  if (!Array.isArray(input.edits) || input.edits.length === 0 || input.edits.length > 100) {
    fail(`${label} edits`, "must contain between 1 and 100 semantic edits");
  }
  for (const [index, raw] of input.edits.entries()) {
    const edit = record(raw, `${label} edit ${index}`);
    const kind = string(edit.kind, `${label} edit ${index} kind`);
    if (kind === "test.patch") {
      record(edit.patch, `${label} edit ${index} patch`);
    } else if (kind === "step.add") {
      record(edit.step, `${label} edit ${index} step`);
      if (edit.placement !== undefined) record(edit.placement, `${label} edit ${index} placement`);
      if (edit.index !== undefined) number(edit.index, `${label} edit ${index} index`);
    } else if (kind === "step.patch") {
      string(edit.stepId, `${label} edit ${index} stepId`);
      record(edit.patch, `${label} edit ${index} patch`);
    } else if (kind === "step.remove") {
      string(edit.stepId, `${label} edit ${index} stepId`);
    } else if (kind === "step.reorder") {
      if (!Array.isArray(edit.orderedStepIds)) {
        fail(`${label} edit ${index} orderedStepIds`, "must be an array");
      }
      edit.orderedStepIds.forEach((id, stepIndex) =>
        string(id, `${label} edit ${index} orderedStepIds ${stepIndex}`),
      );
      if (edit.placement !== undefined) record(edit.placement, `${label} edit ${index} placement`);
    } else if (kind === "step.bind") {
      string(edit.stepId, `${label} edit ${index} stepId`);
      record(edit.binding, `${label} edit ${index} binding`);
    } else if (kind === "step.unbind") {
      string(edit.stepId, `${label} edit ${index} stepId`);
      string(edit.reason, `${label} edit ${index} reason`);
      if (edit.candidates !== undefined && !Array.isArray(edit.candidates)) {
        fail(`${label} edit ${index} candidates`, "must be an array");
      }
    } else {
      fail(`${label} edit ${index} kind`, "is unsupported");
    }
  }
}

const appMapTestEditInputParser = objectParser<OperationInput<"app-map.test.edit">>(
  "Test edit",
  (input) => {
    string(input.appMapId, "Test edit appMapId");
    string(input.testId, "Test edit testId");
    number(input.expectedRevision, "Test edit expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "Test edit eventId");
    validateAppMapTestEdits(input, "Test");
  },
);

const appMapTestProposeInputParser = objectParser<OperationInput<"app-map.test.propose">>(
  "Test proposal",
  (input) => {
    string(input.appMapId, "Test proposal appMapId");
    string(input.testId, "Test proposal testId");
    number(input.expectedRevision, "Test proposal expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "Test proposal eventId");
    if (input.proposalId !== undefined) string(input.proposalId, "Test proposal proposalId");
    if (input.title !== undefined) string(input.title, "Test proposal title");
    if (input.description !== undefined) string(input.description, "Test proposal description");
    validateAppMapTestEdits(input, "Test proposal");
  },
);

const appMapScreenAddParser = objectParser<OperationInput<"app-map.screen.add">>(
  "screen addition",
  (input) => {
    string(input.appMapId, "screen addition appMapId");
    number(input.expectedRevision, "screen addition expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "screen addition eventId");
    const screen = record(input.screen, "screen addition screen");
    string(screen.id, "screen addition screen id");
    string(screen.title, "screen addition screen title");
    if (screen.description !== undefined) string(screen.description, "screen addition description");
    if (screen.identity !== undefined) record(screen.identity, "screen addition identity");
    if (screen.position !== undefined) record(screen.position, "screen addition position");
  },
);

const appMapConnectionCreateParser = objectParser<OperationInput<"app-map.connection.create">>(
  "connection creation",
  (input) => {
    string(input.appMapId, "connection creation appMapId");
    number(input.expectedRevision, "connection creation expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "connection creation eventId");
    const connection = record(input.connection, "connection creation connection");
    string(connection.id, "connection creation id");
    string(connection.fromScreenId, "connection creation fromScreenId");
    const destination = record(connection.destination, "connection creation destination");
    if (destination.kind !== "screen" && destination.kind !== "end") {
      fail("connection creation destination kind", "must be screen or end");
    }
    if (destination.kind === "screen") {
      string(destination.screenId, "connection creation destination screenId");
    }
    if (connection.label !== undefined) string(connection.label, "connection creation label");
    if (connection.caseStackId !== undefined)
      string(connection.caseStackId, "connection creation caseStackId");
    if (
      connection.state !== undefined &&
      connection.state !== "draft" &&
      connection.state !== "ready"
    ) {
      fail("connection creation state", "must be draft or ready");
    }
    if (connection.actions !== undefined && !Array.isArray(connection.actions)) {
      fail("connection creation actions", "must be an array");
    }
  },
);

const appMapFlowSaveParser = objectParser<OperationInput<"app-map.flow.save">>(
  "Flow save",
  (input) => {
    string(input.appMapId, "Flow save appMapId");
    string(input.flowId, "Flow save flowId");
    number(input.expectedRevision, "Flow save expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "Flow save eventId");
    const flow = record(input.flow, "Flow save flow");
    string(flow.name, "Flow save name");
    string(flow.startScreenId, "Flow save startScreenId");
    if (flow.setup !== undefined) {
      const setup = record(flow.setup, "Flow save setup");
      string(setup.routineId, "Flow save setup routineId");
      if (setup.bindings !== undefined) record(setup.bindings, "Flow save setup bindings");
    }
    if (!Array.isArray(flow.connectionIds)) fail("Flow save connectionIds", "must be an array");
    for (const connectionId of flow.connectionIds as unknown[]) {
      string(connectionId, "Flow save connectionId");
    }
  },
);

const appMapRoutineSaveParser = objectParser<OperationInput<"app-map.routine.save">>(
  "Routine save",
  (input) => {
    string(input.appMapId, "Routine save appMapId");
    string(input.routineId, "Routine save routineId");
    number(input.expectedRevision, "Routine save expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "Routine save eventId");
    const routine = record(input.routine, "Routine save routine");
    string(routine.name, "Routine save name");
    if (routine.description !== undefined) string(routine.description, "Routine save description");
    if (routine.parameters !== undefined && !Array.isArray(routine.parameters)) {
      fail("Routine save parameters", "must be an array");
    }
    if (!Array.isArray(routine.actions)) fail("Routine save actions", "must be an array");
  },
);

const appMapOutputParser = objectFieldParser<{ appMap: AppMap }>("App Map response", "appMap");
const appMapCombinePreflightInputParser = objectParser<OperationInput<"app-map.combine.preflight">>(
  "Run matrix preflight",
  (input) => {
    string(input.appMapId, "Run matrix preflight appMapId");
    string(input.combineId, "Run matrix preflight combineId");
    if (input.serial !== undefined) string(input.serial, "Run matrix preflight serial");
  },
);
const appMapCombinePreflightOutputParser = objectFieldParser<
  OperationOutput<"app-map.combine.preflight">
>("Run matrix preflight response", "preflight");

const appMapScreenCaptureParser = objectParser<OperationInput<"app-map.screen.capture">>(
  "App Map screen capture",
  (input) => {
    string(input.appMapId, "App Map screen capture appMapId");
    number(input.expectedRevision, "App Map screen capture expectedRevision");
    if (input.eventId !== undefined) string(input.eventId, "App Map screen capture eventId");
    string(input.leaseId, "App Map screen capture leaseId");
    const target = record(input.target, "App Map screen capture target");
    if (target.kind !== "device" && target.kind !== "browser") {
      fail("App Map screen capture target kind", "must be device or browser");
    }
    if (
      target.platform !== "android" &&
      target.platform !== "ios" &&
      target.platform !== "browser"
    ) {
      fail("App Map screen capture target platform", "must be android, ios, or browser");
    }
    string(target.targetId, "App Map screen capture targetId");
    if (input.title !== undefined) string(input.title, "App Map screen capture title");
    if (input.position !== undefined) {
      const position = record(input.position, "App Map screen capture position");
      number(position.x, "App Map screen capture position x");
      number(position.y, "App Map screen capture position y");
    }
  },
);

const appMapScreenCaptureOutputParser = objectParser<OperationOutput<"app-map.screen.capture">>(
  "App Map screen capture response",
  (output) => {
    string(output.appMapId, "App Map screen capture response appMapId");
    number(output.appMapRevision, "App Map screen capture response revision");
    record(output.screen, "App Map screen capture response screen");
    record(output.variant, "App Map screen capture response variant");
    boolean(output.created, "App Map screen capture response created");
    if (output.reviewProposalId !== undefined)
      string(output.reviewProposalId, "App Map screen capture response reviewProposalId");
  },
);

const appMapTeachParser = objectParser<OperationInput<"app-map.teach">>(
  "App Map teach",
  (input) => {
    string(input.appMapId, "App Map teach appMapId");
    if (input.expectedRevision !== undefined) {
      number(input.expectedRevision, "App Map teach expectedRevision");
    }
    if (input.eventId !== undefined) string(input.eventId, "App Map teach eventId");
    string(input.leaseId, "App Map teach leaseId");
    const target = record(input.target, "App Map teach target");
    if (target.kind !== "device" && target.kind !== "browser") {
      fail("App Map teach target kind", "must be device or browser");
    }
    if (
      target.platform !== "android" &&
      target.platform !== "ios" &&
      target.platform !== "browser"
    ) {
      fail("App Map teach target platform", "must be android, ios, or browser");
    }
    string(target.targetId, "App Map teach targetId");
    if (input.fromScreenId !== undefined) string(input.fromScreenId, "App Map teach fromScreenId");
    if (input.title !== undefined) string(input.title, "App Map teach title");
    if (input.label !== undefined) string(input.label, "App Map teach label");
    if (input.interaction !== undefined) {
      const interaction = record(input.interaction, "App Map teach interaction");
      const kind = string(interaction.kind, "App Map teach interaction kind");
      if (kind === "point") {
        number(interaction.x, "App Map teach interaction x");
        number(interaction.y, "App Map teach interaction y");
      } else if (kind === "label") {
        string(interaction.label, "App Map teach interaction label");
        if (interaction.point !== undefined) {
          const point = record(interaction.point, "App Map teach interaction point");
          number(point.x, "App Map teach interaction point x");
          number(point.y, "App Map teach interaction point y");
        }
      } else if (kind === "identifier") {
        string(interaction.identifier, "App Map teach interaction identifier");
        if (interaction.point !== undefined) {
          const point = record(interaction.point, "App Map teach interaction point");
          number(point.x, "App Map teach interaction point x");
          number(point.y, "App Map teach interaction point y");
        }
      } else if (kind === "swipe") {
        const from = record(interaction.from, "App Map teach swipe from");
        number(from.x, "App Map teach swipe from x");
        number(from.y, "App Map teach swipe from y");
        const to = record(interaction.to, "App Map teach swipe to");
        number(to.x, "App Map teach swipe to x");
        number(to.y, "App Map teach swipe to y");
        if (interaction.durationMs !== undefined) {
          number(interaction.durationMs, "App Map teach swipe durationMs");
        }
      } else {
        fail("App Map teach interaction kind", "must be point, label, identifier, or swipe");
      }
    }
  },
);

const appMapTeachOutputParser = objectParser<OperationOutput<"app-map.teach">>(
  "App Map teach response",
  (output) => {
    string(output.appMapId, "App Map teach response appMapId");
    number(output.appMapRevision, "App Map teach response revision");
    record(output.screen, "App Map teach response screen");
    record(output.variant, "App Map teach response variant");
    boolean(output.created, "App Map teach response created");
    if (output.reviewProposalId !== undefined)
      string(output.reviewProposalId, "App Map teach response reviewProposalId");
    if (output.connectionId !== undefined)
      string(output.connectionId, "App Map teach connectionId");
  },
);

const observationProposalInputParser = objectParser<OperationInput<"app-map.observations.propose">>(
  "observation proposal",
  (input) => {
    string(input.appMapId, "observation proposal appMapId");
    string(input.sessionId, "observation proposal sessionId");
    number(input.expectedRevision, "observation proposal expectedRevision");
    if (input.proposalId !== undefined) string(input.proposalId, "observation proposal proposalId");
    if (input.title !== undefined) string(input.title, "observation proposal title");
    if (
      input.transitionIds !== undefined &&
      (!Array.isArray(input.transitionIds) ||
        input.transitionIds.some((id) => typeof id !== "string" || !id.trim()))
    ) {
      fail("observation proposal transitionIds", "must contain non-empty strings");
    }
    if (input.eventId !== undefined) string(input.eventId, "observation proposal eventId");
  },
);

const observationProposalOutputParser = objectParser<
  OperationOutput<"app-map.observations.propose">
>("observation proposal response", (input) => {
  record(input.appMap, "observation proposal App Map");
  string(input.proposalId, "observation proposal proposalId");
});

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

const generic = operationRecordParser;

type DefinitionOptions = Omit<
  OperationDefinition<OperationId>,
  "version" | "input" | "output" | "minimumRole"
> & {
  input?: RuntimeParser<unknown>;
  output?: RuntimeParser<unknown>;
  minimumRole?: ProjectRole;
};

function operation(options: DefinitionOptions): OperationDefinition<OperationId> {
  return {
    ...options,
    version: 1,
    minimumRole: options.minimumRole ?? defaultMinimumRole(options),
    input: options.input ?? generic,
    output: options.output ?? generic,
  };
}

function defaultMinimumRole(options: DefinitionOptions): ProjectRole {
  if (options.mode !== "command") return "viewer";
  if (options.confirmation === "dangerous" || options.category === "workspace") return "admin";
  if (options.lease === "exclusive") return "runner";
  if (options.category === "execution" || options.category === "target") return "runner";
  if (options.category === "authoring" || options.category === "evidence") return "author";
  if (options.category === "discovery" || options.category === "corpus") {
    return options.progress ? "runner" : "author";
  }
  return "author";
}

const query = (
  id: OperationId,
  label: string,
  path: string,
  options: Partial<DefinitionOptions> = {},
) =>
  operation({
    id,
    label,
    category: "workspace",
    mode: "query",
    idempotency: "inherent",
    targetCapabilities: [],
    lease: "none",
    confirmation: "none",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path },
    ...options,
  });

const command = (
  id: OperationId,
  label: string,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  options: Partial<DefinitionOptions> = {},
) =>
  operation({
    id,
    label,
    category: "workspace",
    mode: "command",
    idempotency: method === "DELETE" ? "inherent" : "optional",
    targetCapabilities: [],
    lease: "none",
    confirmation: method === "DELETE" ? "confirm" : "none",
    progress: false,
    cancellable: false,
    transport: { method, path },
    ...options,
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
  query("app-map.list", "List App Maps", "/app-maps", {
    category: "authoring",
    input: emptyInputParser,
    output: arrayFieldParser<{ appMaps: AppMap[] }>("App Maps response", "appMaps"),
  }),
  query("app-map.get", "Get App Map", "/app-maps/:appMapId", {
    category: "authoring",
    input: appMapRefParser,
    output: appMapOutputParser,
  }),
  command("app-map.remove", "Remove App Map", "POST", "/app-maps/:appMapId/remove", {
    category: "authoring",
    confirmation: "confirm",
    input: appMapRefParser,
    output: okParser,
  }),
  command("app-map.create", "Create App Map", "POST", "/app-maps", {
    category: "authoring",
    input: appMapCreateParser,
    output: appMapOutputParser,
  }),
  command("app-map.duplicate", "Duplicate App Map", "POST", "/app-maps/:sourceAppMapId/duplicate", {
    category: "authoring",
    input: appMapDuplicateParser,
    output: appMapOutputParser,
  }),
  query("app-map.export", "Export App Map YAML", "/app-maps/:appMapId/export", {
    category: "authoring",
    input: appMapRefParser,
    output: appMapExportParser,
  }),
  command("app-map.import", "Import App Map YAML", "POST", "/app-maps/import", {
    category: "authoring",
    input: appMapImportParser,
    output: appMapImportOutputParser,
  }),
  command("app-map.update", "Update App Map", "PUT", "/app-maps/:appMapId", {
    category: "authoring",
    input: appMapMutationParser<"app-map.update">("App Map update", "patch"),
    output: appMapOutputParser,
  }),
  command("app-map.commit", "Commit App Map changes", "POST", "/app-maps/:appMapId/commit", {
    category: "authoring",
    input: objectParser<OperationInput<"app-map.commit">>("App Map commit", (input) => {
      string(input.appMapId, "App Map commit appMapId");
      number(input.expectedRevision, "App Map commit expectedRevision");
      if (input.eventId !== undefined) string(input.eventId, "App Map commit eventId");
      if (input.summary !== undefined) string(input.summary, "App Map commit summary");
      if (!Array.isArray(input.changes)) fail("App Map commit changes", "must be an array");
      if (input.patch !== undefined) record(input.patch, "App Map commit patch");
    }),
    output: appMapOutputParser,
  }),
  command("app-map.screen.add", "Add App Map screen", "POST", "/app-maps/:appMapId/screens", {
    category: "authoring",
    input: appMapScreenAddParser,
    output: appMapOutputParser,
  }),
  command(
    "app-map.screen.capture",
    "Capture current target as an App Map screen",
    "POST",
    "/app-maps/:appMapId/screens/capture",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
      input: appMapScreenCaptureParser,
      output: appMapScreenCaptureOutputParser,
    },
  ),
  command(
    "app-map.teach",
    "Tap a control, capture the destination, and connect it on the App Map",
    "POST",
    "/app-maps/:appMapId/teach",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot", "tap"],
      lease: "exclusive",
      input: appMapTeachParser,
      output: appMapTeachOutputParser,
    },
  ),
  command(
    "app-map.screen.update",
    "Update App Map screen",
    "PUT",
    "/app-maps/:appMapId/screens/:screenId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.screen.update">("screen update", "input", ["screenId"]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.screen.remove",
    "Remove App Map screen",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.screen.remove">("screen removal", undefined, [
        "screenId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.connection.create",
    "Create App Map connection",
    "POST",
    "/app-maps/:appMapId/connections",
    {
      category: "authoring",
      input: appMapConnectionCreateParser,
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.connection.update",
    "Update App Map connection",
    "PUT",
    "/app-maps/:appMapId/connections/:connectionId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.connection.update">("connection update", "patch", [
        "connectionId",
      ]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.connection.remove",
    "Remove App Map connection",
    "POST",
    "/app-maps/:appMapId/connections/:connectionId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.connection.remove">("connection removal", undefined, [
        "connectionId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.group.save",
    "Save App Map Group",
    "PUT",
    "/app-maps/:appMapId/groups/:groupId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.group.save">("Group save", "group", ["groupId"]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.group.remove",
    "Remove App Map Group",
    "POST",
    "/app-maps/:appMapId/groups/:groupId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.group.remove">("Group removal", undefined, ["groupId"]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command("app-map.flow.save", "Save App Map Flow", "PUT", "/app-maps/:appMapId/flows/:flowId", {
    category: "authoring",
    input: appMapFlowSaveParser,
    output: appMapOutputParser,
  }),
  command("app-map.flow.run", "Run App Map flow", "POST", "/app-maps/:appMapId/flows/:flowId/run", {
    category: "execution",
    input: appMapFlowRunParser,
    output: appMapFlowRunOutputParser,
    targetCapabilities: ["tap", "type", "scroll", "screenshot"],
    lease: "exclusive",
    progress: true,
    cancellable: true,
  }),
  command(
    "app-map.connection.run",
    "Replay App Map connection",
    "POST",
    "/app-maps/:appMapId/connections/:connectionId/run",
    {
      category: "execution",
      input: appMapConnectionRunParser,
      output: appMapConnectionRunOutputParser,
      targetCapabilities: ["tap", "type", "scroll", "screenshot"],
      lease: "exclusive",
      progress: true,
      cancellable: true,
    },
  ),
  command(
    "app-map.flow.remove",
    "Remove App Map Flow",
    "POST",
    "/app-maps/:appMapId/flows/:flowId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.flow.remove">("Flow removal", undefined, ["flowId"]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.case-stack.save",
    "Save App Map case stack",
    "PUT",
    "/app-maps/:appMapId/case-stacks/:caseStackId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.case-stack.save">("Case stack save", "caseStack", [
        "caseStackId",
      ]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.case-stack.attach",
    "Apply an App Map case stack to a connection",
    "POST",
    "/app-maps/:appMapId/connections/:connectionId/case-stack",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.case-stack.attach">("Case stack attachment", undefined, [
        "connectionId",
        "caseStackId",
      ]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.case-stack.remove",
    "Remove App Map case stack",
    "POST",
    "/app-maps/:appMapId/case-stacks/:caseStackId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.case-stack.remove">("Case stack removal", undefined, [
        "caseStackId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.variable.save",
    "Save an App Map variable",
    "PUT",
    "/app-maps/:appMapId/variables/:variableId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.variable.save">("Variable save", "variable", [
        "variableId",
      ]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.variable.remove",
    "Remove an App Map variable",
    "POST",
    "/app-maps/:appMapId/variables/:variableId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.variable.remove">("Variable removal", undefined, [
        "variableId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.test.save",
    "Save a graph-native, path, or tour map test",
    "PUT",
    "/app-maps/:appMapId/tests/:testId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.test.save">("Test save", "test", ["testId"]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.test.remove",
    "Remove a map test",
    "POST",
    "/app-maps/:appMapId/tests/:testId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.test.remove">("Test removal", undefined, ["testId"]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.test.edit",
    "Apply stable-ID edits to a graph-native map test",
    "POST",
    "/app-maps/:appMapId/tests/:testId/edit",
    {
      category: "authoring",
      input: appMapTestEditInputParser,
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.test.propose",
    "Propose stable-ID edits to a graph-native map test",
    "POST",
    "/app-maps/:appMapId/tests/:testId/proposals",
    {
      category: "authoring",
      input: appMapTestProposeInputParser,
      output: objectParser<OperationOutput<"app-map.test.propose">>(
        "Test proposal response",
        (output) => {
          record(output.appMap, "Test proposal App Map");
          string(output.proposalId, "Test proposal proposalId");
        },
      ),
    },
  ),
  query(
    "app-map.test.compile",
    "Compile and validate a graph-native map test",
    "/app-maps/:appMapId/tests/:testId/compile",
    {
      category: "authoring",
      input: objectParser<OperationInput<"app-map.test.compile">>("Test compilation", (input) => {
        string(input.appMapId, "Test compilation appMapId");
        string(input.testId, "Test compilation testId");
      }),
      output: objectParser<OperationOutput<"app-map.test.compile">>(
        "Test compilation response",
        (output) => record(output.plan, "Test compilation plan"),
      ),
    },
  ),
  command(
    "app-map.combine.preflight",
    "Preview a run matrix without starting it",
    "POST",
    "/app-maps/:appMapId/combines/:combineId/preflight",
    {
      category: "authoring",
      input: appMapCombinePreflightInputParser,
      output: appMapCombinePreflightOutputParser,
    },
  ),
  command(
    "app-map.combine.save",
    "Save a run matrix (state sets × tests)",
    "PUT",
    "/app-maps/:appMapId/combines/:combineId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.combine.save">("Run matrix save", "combine", [
        "combineId",
      ]),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.combine.remove",
    "Remove a run matrix",
    "POST",
    "/app-maps/:appMapId/combines/:combineId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.combine.remove">("Run matrix removal", undefined, [
        "combineId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.routine.save",
    "Save App Map Routine",
    "PUT",
    "/app-maps/:appMapId/routines/:routineId",
    {
      category: "authoring",
      input: appMapRoutineSaveParser,
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.routine.remove",
    "Remove App Map Routine",
    "POST",
    "/app-maps/:appMapId/routines/:routineId/remove",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.routine.remove">("Routine removal", undefined, [
        "routineId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.proposal.submit",
    "Submit App Map proposal",
    "POST",
    "/app-maps/:appMapId/proposals",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.proposal.submit">("proposal submission", "proposal"),
      output: appMapOutputParser,
    },
  ),
  command(
    "app-map.observations.propose",
    "Propose observed App Map path",
    "POST",
    "/app-maps/:appMapId/observation-proposals",
    {
      category: "authoring",
      input: observationProposalInputParser,
      output: observationProposalOutputParser,
    },
  ),
  command(
    "app-map.proposal.approve",
    "Approve App Map proposal",
    "POST",
    "/app-maps/:appMapId/proposals/:proposalId/approve",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.proposal.approve">("proposal approval", undefined, [
        "proposalId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.proposal.reject",
    "Reject App Map proposal",
    "POST",
    "/app-maps/:appMapId/proposals/:proposalId/reject",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.proposal.reject">("proposal rejection", undefined, [
        "proposalId",
      ]),
      output: appMapOutputParser,
      confirmation: "confirm",
    },
  ),
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
  query("discovery.list", "List Discovery Maps", "/discovery", { category: "discovery" }),
  command("discovery.create", "Create Discovery Map", "POST", "/discovery", {
    category: "discovery",
  }),
  query("discovery.get", "Get Discovery Map", "/discovery/:sessionId", { category: "discovery" }),
  command("discovery.rename", "Rename Discovery Map", "POST", "/discovery/:sessionId/name", {
    category: "discovery",
  }),
  command(
    "discovery.status.update",
    "Update Discovery status",
    "POST",
    "/discovery/:sessionId/status",
    {
      category: "discovery",
    },
  ),
  command(
    "discovery.capture",
    "Capture discovered screen",
    "POST",
    "/discovery/:sessionId/capture",
    {
      category: "discovery",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "shared",
    },
  ),
  command(
    "discovery.interact",
    "Explore discovered control",
    "POST",
    "/discovery/:sessionId/interact",
    {
      category: "discovery",
      targetCapabilities: ["tap"],
      lease: "exclusive",
    },
  ),
  query(
    "discovery.suggestion",
    "Suggest next Discovery control",
    "/discovery/:sessionId/suggestion",
    {
      category: "discovery",
    },
  ),
  query("discovery.coverage", "Discovery coverage report", "/discovery/:sessionId/coverage", {
    category: "discovery",
  }),
  query("discovery.export", "Export Discovery Map", "/discovery/:sessionId/export", {
    category: "discovery",
  }),
  command("discovery.promote", "Promote Discovery path", "POST", "/discovery/:sessionId/promote", {
    category: "discovery",
  }),
  query("corpus.list", "List corpus sessions", "/corpus", { category: "corpus" }),
  command("corpus.create", "Create corpus session", "POST", "/corpus", {
    category: "corpus",
  }),
  query("corpus.get", "Get corpus session", "/corpus/:sessionId", { category: "corpus" }),
  command("corpus.rename", "Rename corpus session", "POST", "/corpus/:sessionId/name", {
    category: "corpus",
  }),
  command("corpus.status.update", "Update corpus status", "POST", "/corpus/:sessionId/status", {
    category: "corpus",
  }),
  command("corpus.start", "Start settings corpus crawl", "POST", "/corpus/:sessionId/start", {
    category: "corpus",
    targetCapabilities: ["tap", "snapshot", "screenshot", "launch"],
    lease: "exclusive",
    progress: true,
    cancellable: true,
  }),
  command("corpus.cancel", "Cancel corpus crawl", "POST", "/corpus/:sessionId/cancel", {
    category: "corpus",
    confirmation: "confirm",
    minimumRole: "runner",
  }),
  query("corpus.coverage", "Corpus locale coverage", "/corpus/:sessionId/coverage", {
    category: "corpus",
  }),
  query("corpus.analysis", "Analyze corpus evidence", "/corpus/:sessionId/analysis", {
    category: "corpus",
  }),
  query("corpus.export", "Export corpus pack", "/corpus/:sessionId/export", {
    category: "corpus",
  }),
  query("corpus.screen.get", "Get corpus screenshot", "/corpus/:sessionId/screens/:screenId", {
    category: "corpus",
  }),

  query("language-profile.list", "List language profiles", "/language-profiles", {
    category: "corpus",
  }),
  query("switcher-profile.list", "List switcher profiles", "/switcher-profiles", {
    category: "corpus",
  }),
  command("switcher-profile.scan", "Scan app switcher picker", "POST", "/switcher-profiles/scan", {
    category: "corpus",
    targetCapabilities: ["tap", "snapshot", "launch"],
    lease: "exclusive",
    progress: true,
  }),
  command("switcher-profile.save", "Save switcher profile", "POST", "/switcher-profiles", {
    category: "corpus",
  }),

  command("language-profile.scan", "Scan app language picker", "POST", "/language-profiles/scan", {
    category: "corpus",
    targetCapabilities: ["tap", "snapshot", "launch"],
    lease: "exclusive",
    progress: true,
  }),
  command("language-profile.save", "Save language profile", "POST", "/language-profiles", {
    category: "corpus",
  }),

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
  command(
    "job.locale-matrix.infer",
    "Infer locale options from taught live-screen rows",
    "POST",
    "/jobs/locale-matrix/infer",
    {
      category: "execution",
    },
  ),
  command("job.combine.start", "Run state combinations × tests", "POST", "/jobs/combine", {
    category: "execution",
    progress: true,
    cancellable: true,
    lease: "exclusive",
    targetCapabilities: ["tap", "snapshot", "screenshot", "launch"],
  }),
  query(
    "job.combine.export",
    "Export run-matrix screenshot pack",
    "/jobs/combine/:batchId/export",
    {
      category: "execution",
    },
  ),
  command(
    "job.combine.infer",
    "Infer variable rows from taught live-screen rows",
    "POST",
    "/jobs/combine/infer",
    {
      category: "execution",
    },
  ),
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
