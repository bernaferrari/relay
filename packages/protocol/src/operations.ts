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
  type CommitAuthoringSessionInput,
  type CreateAuthoringSessionInput,
  type ReorderAuthoringTakeInput,
  type ReplaceAuthoringActionInput,
  type TrimAuthoringTakeInput,
} from "./authoring.js";
import {
  parseCollaborationAppendInput,
  parseCollaborationAppendResponse,
  parseCollaborationAwarenessListResponse,
  parseCollaborationAwarenessPublishInput,
  parseCollaborationAwarenessRemoveResponse,
  parseCollaborationAwarenessResponse,
  parseCollaborationDocumentResponse,
  parseCollaborationJourneyInput,
  parseCollaborationSyncInput,
  type CollaborationAppendInput,
  type CollaborationAppendResponse,
  type CollaborationAwarenessListResponse,
  type CollaborationAwarenessPublishInput,
  type CollaborationAwarenessRemoveResponse,
  type CollaborationAwarenessResponse,
  type CollaborationDocumentResponse,
  type CollaborationJourneyInput,
  type CollaborationSyncInput,
} from "./collaboration.js";
import type {
  AddScreenInput,
  AppMap,
  AppMapCompiledFlow,
  AppMapPatch,
  Connection,
  ConnectionPatch,
  Flow,
  Proposal,
  Routine,
  UpdateScreenInput,
} from "./app-map.js";
import type {
  VisualBaseline,
  VisualComparison,
  VisualReviewAction,
  VisualReviewDecision,
} from "./visual-verification.js";
import type {
  DevicePoolPreflight,
  InstalledBuild,
  LaunchedBuild,
  RegisteredBuildPreflight,
  TargetWorkerStatus,
} from "./target-runtime.js";
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

type TestVariableDto = {
  id: string;
  name: string;
  source: "static" | "list" | "generated";
  fallback: string;
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
};

type GenerationResultDto = {
  provider: string;
  model: string;
  values: string[];
  generatedAt: number;
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

type JourneyDto = {
  id: string;
  title: string;
  steps: unknown[];
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
};

type CollectionDto = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
};

export type OperationMode = "query" | "command" | "stream";
export type OperationIdempotency = "none" | "optional" | "required" | "inherent";
export type OperationConfirmation = "none" | "confirm" | "dangerous";
export type OperationCategory =
  | "system"
  | "target"
  | "authoring"
  | "execution"
  | "evidence"
  | "workspace"
  | "discovery";

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
};

type SpecificOperationMap = {
  "system.health.get": { input: Record<string, never>; output: HealthSummary };
  "event.stream": { input: Record<string, never>; output: OperationRecord };
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
    input: { serial: string };
    output: { nodes: unknown[]; interactive: unknown[]; tree: string };
  };
  "target.screenshot.capture": {
    input: { serial: string };
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
        matchedScreenId: string | null;
        status: "observed" | "unavailable";
      };
    };
  };
  "job.list": {
    input: { full?: boolean; limit?: number };
    output: { jobs: JobSummaryDto[]; active?: JobSummaryDto | null };
  };
  "job.get": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.start": {
    input: { action: string; serial?: string; [key: string]: unknown };
    output: { job: OperationRecord };
  };
  "job.cancel": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.pause": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.resume": { input: { jobId: string }; output: { job: OperationRecord } };
  "run.list": { input: Record<string, never>; output: { runs: RunSummaryDto[] } };
  "run.get": { input: { runId: string }; output: { run: OperationRecord } };
  "run.evidence.get": {
    input: { runId: string; limit?: number; includeBodies?: boolean };
    output: { evidence: OperationRecord };
  };
  "run.visual.compare": {
    input: { runId: string };
    output: { comparison: VisualComparison };
  };
  "run.visual.review": {
    input: { runId: string; comparisonId: string; action: VisualReviewAction; note?: string };
    output: { decision: VisualReviewDecision; baseline: VisualBaseline | null };
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
    output: RevisionedDto<TestVariableDto[]>;
  };
  "workspace.variables.update": {
    input: RevisionWriteDto<TestVariableDto[]>;
    output: RevisionedDto<TestVariableDto[]>;
  };
  "app-map.list": { input: Record<string, never>; output: { appMaps: AppMap[] } };
  "app-map.get": { input: { appMapId: string }; output: { appMap: AppMap } };
  "app-map.create": {
    input: { appMapId: string; name: string };
    output: { appMap: AppMap };
  };
  "app-map.update": {
    input: { appMapId: string; expectedRevision: number; eventId?: string; patch: AppMapPatch };
    output: { appMap: AppMap };
  };
  "app-map.screen.add": {
    input: { appMapId: string; expectedRevision: number; eventId?: string; input: AddScreenInput };
    output: { appMap: AppMap };
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
    input: { appMapId: string; expectedRevision: number; eventId?: string; connection: Connection };
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
  "app-map.flow.save": {
    input: {
      appMapId: string;
      flowId: string;
      expectedRevision: number;
      eventId?: string;
      flow: Flow;
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
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      variables?: Record<string, string>;
    };
    output: { job: OperationRecord; plan: AppMapCompiledFlow };
  };
  "app-map.routine.save": {
    input: {
      appMapId: string;
      routineId: string;
      expectedRevision: number;
      eventId?: string;
      routine: Routine;
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
  "journey.document.get": {
    input: { journeyId: string };
    output: RevisionedDto<unknown>;
  };
  "journey.document.update": {
    input: { journeyId: string } & RevisionWriteDto<unknown>;
    output: RevisionedDto<unknown>;
  };
  "collaboration.document.bootstrap": {
    input: CollaborationJourneyInput;
    output: CollaborationDocumentResponse;
  };
  "collaboration.document.sync": {
    input: CollaborationSyncInput;
    output: CollaborationDocumentResponse;
  };
  "collaboration.update.append": {
    input: CollaborationAppendInput;
    output: CollaborationAppendResponse;
  };
  "collaboration.status.get": {
    input: CollaborationJourneyInput;
    output: CollaborationDocumentResponse;
  };
  "collaboration.document.export": {
    input: CollaborationJourneyInput;
    output: CollaborationDocumentResponse;
  };
  "collaboration.document.repair": {
    input: CollaborationJourneyInput;
    output: CollaborationDocumentResponse;
  };
  "collaboration.awareness.publish": {
    input: CollaborationAwarenessPublishInput;
    output: CollaborationAwarenessResponse;
  };
  "collaboration.awareness.list": {
    input: CollaborationJourneyInput;
    output: CollaborationAwarenessListResponse;
  };
  "collaboration.awareness.remove": {
    input: CollaborationJourneyInput;
    output: CollaborationAwarenessRemoveResponse;
  };
  "authoring.session.list": {
    input: Record<string, never>;
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
  "authoring.session.observe": {
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
  "lease.list": { input: Record<string, never>; output: { leases: DeviceLeaseDto[] } };
  "lease.create": {
    input: Pick<DeviceLeaseDto, "poolId" | "deviceSerial" | "expiresAt">;
    output: { lease: DeviceLeaseDto };
  };
  "lease.release": { input: { leaseId: string }; output: { lease: DeviceLeaseDto } };
  "journey.list": { input: Record<string, never>; output: { journeys: JourneyDto[] } };
  "journey.get": { input: { journeyId: string }; output: { journey: JourneyDto } };
  "journey.create": {
    input: OperationRecord & { expectedRevision: number };
    output: { journey: JourneyDto };
  };
  "journey.update": {
    input: { journeyId: string; expectedRevision: number } & OperationRecord;
    output: { journey: JourneyDto };
  };
  "journey.delete": { input: { journeyId: string }; output: { ok: true } };
  "journey.history.restore": {
    input: { journeyId: string; updatedAt: number };
    output: { journey: JourneyDto };
  };
  "collection.list": { input: Record<string, never>; output: { collections: CollectionDto[] } };
  "collection.get": {
    input: { collectionId: string };
    output: { collection: CollectionDto };
  };
  "collection.create": {
    input: OperationRecord & { expectedRevision: number };
    output: { collection: CollectionDto };
  };
  "collection.update": {
    input: { collectionId: string; expectedRevision: number } & OperationRecord;
    output: { collection: CollectionDto };
  };
  "collection.delete": { input: { collectionId: string }; output: { ok: true } };
  "collection.restore": {
    input: { collectionId: string; updatedAt: number };
    output: { collection: CollectionDto };
  };
};

type GenericOperationId =
  | "system.doctor.get"
  | "system.audit.list"
  | "workspace.apple-device.update"
  | "target.list"
  | "target.create"
  | "target.delete"
  | "target.preflight"
  | "target.open"
  | "target.boot"
  | "target.authorize"
  | "target.interact"
  | "target.touch"
  | "target.key"
  | "target.scroll"
  | "target.video.start"
  | "action.run"
  | "journey.import"
  | "journey.evidence.save"
  | "collection.run"
  | "schedule.list"
  | "schedule.create"
  | "schedule.delete"
  | "matrix.list"
  | "matrix.create"
  | "matrix.update"
  | "matrix.delete"
  | "matrix.import"
  | "matrix.resolve"
  | "discovery.list"
  | "discovery.create"
  | "discovery.rename"
  | "discovery.status.update"
  | "discovery.capture"
  | "discovery.interact"
  | "discovery.promote"
  | "job.retry"
  | "job.active.cancel"
  | "job.graph-path.start"
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
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(label, "must be a number");
  return value;
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
});

const devicesParser = objectParser<{ devices: DeviceSummary[] }>("devices response", (input) => {
  if (!Array.isArray(input.devices)) fail("devices", "must be an array");
  for (const item of input.devices) {
    const device = record(item, "device");
    string(device.id, "device id");
    string(device.serial, "device serial");
    string(device.name, "device name");
  }
});

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
});

const startJobInputParser = objectParser<OperationInput<"job.start">>("job input", (input) => {
  string(input.action, "job action");
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

const revisionedVariablesParser = objectParser<RevisionedDto<TestVariableDto[]>>(
  "variables response",
  (input) => {
    number(input.revision, "variables revision");
    number(input.updatedAt, "variables updatedAt");
    if (!Array.isArray(input.value)) fail("variables value", "must be an array");
  },
);

const revisionedJourneyParser = objectParser<RevisionedDto<unknown>>(
  "Journey document response",
  (input) => {
    number(input.revision, "Journey revision");
    number(input.updatedAt, "Journey updatedAt");
    record(input.value, "Journey document");
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

const appMapFlowRunParser = objectParser<OperationInput<"app-map.flow.run">>(
  "App Map flow run input",
  (input) => {
    string(input.appMapId, "App Map flow run appMapId");
    string(input.flowId, "App Map flow run flowId");
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
        string(value, `App Map variable ${name}`);
      }
    }
  },
);

const appMapFlowRunOutputParser = objectParser<OperationOutput<"app-map.flow.run">>(
  "App Map flow run response",
  (input) => {
    record(input.job, "App Map flow run job");
    record(input.plan, "App Map flow run plan");
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

const appMapOutputParser = objectFieldParser<{ appMap: AppMap }>("App Map response", "appMap");

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
});

const generationOutputParser = objectParser<GenerationResultDto>("generation response", (input) => {
  string(input.provider, "generation provider");
  string(input.model, "generation model");
  if (!Array.isArray(input.values) || input.values.some((value) => typeof value !== "string")) {
    fail("generation values", "must be an array of strings");
  }
  number(input.generatedAt, "generation generatedAt");
});

const revisionWriteInputParser = objectParser<OperationRecord>("revisioned write", (input) => {
  const revision = number(input.expectedRevision, "expectedRevision");
  if (revision < 0) {
    fail("expectedRevision", "must be non-negative");
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

const collaborationJourneyInputParser: RuntimeParser<CollaborationJourneyInput> = {
  description: "scoped collaborative Journey input",
  parse: parseCollaborationJourneyInput,
};

const collaborationSyncInputParser: RuntimeParser<CollaborationSyncInput> = {
  description: "bounded collaborative Journey state-vector sync input",
  parse: parseCollaborationSyncInput,
};

const collaborationAppendInputParser: RuntimeParser<CollaborationAppendInput> = {
  description: "bounded idempotent collaborative Journey update input",
  parse: parseCollaborationAppendInput,
};

const collaborationDocumentResponseParser: RuntimeParser<CollaborationDocumentResponse> = {
  description: "bounded collaborative Journey update and metrics response",
  parse: parseCollaborationDocumentResponse,
};

const collaborationAppendResponseParser: RuntimeParser<CollaborationAppendResponse> = {
  description: "collaborative Journey append result",
  parse: parseCollaborationAppendResponse,
};

const collaborationAwarenessPublishParser: RuntimeParser<CollaborationAwarenessPublishInput> = {
  description: "bounded ephemeral collaboration awareness input",
  parse: parseCollaborationAwarenessPublishInput,
};

const collaborationAwarenessResponseParser: RuntimeParser<CollaborationAwarenessResponse> = {
  description: "ephemeral collaboration awareness response",
  parse: parseCollaborationAwarenessResponse,
};

const collaborationAwarenessListParser: RuntimeParser<CollaborationAwarenessListResponse> = {
  description: "ephemeral collaboration awareness list response",
  parse: parseCollaborationAwarenessListResponse,
};

const collaborationAwarenessRemoveParser: RuntimeParser<CollaborationAwarenessRemoveResponse> = {
  description: "ephemeral collaboration awareness removal response",
  parse: parseCollaborationAwarenessRemoveResponse,
};

const authoringSessionListParser: RuntimeParser<AuthoringSessionListResponse> = {
  description: "authoring session list response",
  parse: parseAuthoringSessionListResponse,
};

const generic = operationRecordParser;

type DefinitionOptions = Omit<OperationDefinition<OperationId>, "version" | "input" | "output"> & {
  input?: RuntimeParser<unknown>;
  output?: RuntimeParser<unknown>;
};

function operation(options: DefinitionOptions): OperationDefinition<OperationId> {
  return {
    ...options,
    version: 1,
    input: options.input ?? generic,
    output: options.output ?? generic,
  };
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
  query("system.audit.list", "List audit events", "/audit", { category: "system" }),
  query("event.stream", "Stream Relay events", "/events", {
    category: "system",
    mode: "stream",
  }),
  query("workspace.privacy.get", "Get privacy policy", "/settings/privacy", {
    input: emptyInputParser,
    output: redactionPolicyParser,
  }),
  command("workspace.privacy.update", "Update privacy policy", "PUT", "/settings/privacy", {
    input: enabledInputParser,
    output: redactionPolicyParser,
  }),
  query("workspace.evidence.get", "Get evidence policy", "/settings/evidence", {
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
    input: emptyInputParser,
    output: devicesParser,
  }),
  query("target.list", "List managed targets", "/targets", { category: "target" }),
  command("target.create", "Create managed target", "POST", "/targets", { category: "target" }),
  command("target.delete", "Delete managed target", "DELETE", "/targets/:targetId", {
    category: "target",
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
  command("target.interact", "Interact with target", "POST", "/interact", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
    input: targetInputParser,
  }),
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
    targetCapabilities: ["recording"],
    lease: "shared",
    input: targetInputParser,
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
    input: emptyInputParser,
    output: arrayFieldParser("leases response", "leases"),
  }),
  command("lease.create", "Lease target", "POST", "/device-leases", {
    confirmation: "confirm",
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
  command("app-map.create", "Create App Map", "POST", "/app-maps", {
    category: "authoring",
    input: appMapCreateParser,
    output: appMapOutputParser,
  }),
  command("app-map.update", "Update App Map", "PUT", "/app-maps/:appMapId", {
    category: "authoring",
    input: appMapMutationParser<"app-map.update">("App Map update", "patch"),
    output: appMapOutputParser,
  }),
  command("app-map.screen.add", "Add App Map screen", "POST", "/app-maps/:appMapId/screens", {
    category: "authoring",
    input: appMapMutationParser<"app-map.screen.add">("screen addition", "input"),
    output: appMapOutputParser,
  }),
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
      input: appMapMutationParser<"app-map.connection.create">("connection creation", "connection"),
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
  command("app-map.flow.save", "Save App Map Flow", "PUT", "/app-maps/:appMapId/flows/:flowId", {
    category: "authoring",
    input: appMapMutationParser<"app-map.flow.save">("Flow save", "flow", ["flowId"]),
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
    "app-map.routine.save",
    "Save App Map Routine",
    "PUT",
    "/app-maps/:appMapId/routines/:routineId",
    {
      category: "authoring",
      input: appMapMutationParser<"app-map.routine.save">("Routine save", "routine", ["routineId"]),
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
  query("journey.list", "List Journeys", "/journeys", {
    category: "authoring",
    input: emptyInputParser,
    output: arrayFieldParser("Journeys response", "journeys"),
  }),
  query("journey.get", "Get Journey", "/journeys/:journeyId", {
    category: "authoring",
    output: objectFieldParser("Journey response", "journey"),
  }),
  command("journey.create", "Create Journey", "POST", "/journeys", {
    category: "authoring",
    input: revisionWriteInputParser,
    output: objectFieldParser("Journey response", "journey"),
  }),
  command("journey.update", "Update Journey", "PUT", "/journeys/:journeyId", {
    category: "authoring",
    input: revisionWriteInputParser,
    output: objectFieldParser("Journey response", "journey"),
  }),
  command("journey.delete", "Delete Journey", "DELETE", "/journeys/:journeyId", {
    category: "authoring",
    output: okParser,
  }),
  command("journey.import", "Import Journey", "POST", "/journeys/import", {
    category: "authoring",
  }),
  command(
    "journey.history.restore",
    "Restore Journey history",
    "POST",
    "/journeys/:journeyId/history",
    {
      category: "authoring",
      confirmation: "confirm",
      output: objectFieldParser("Journey response", "journey"),
    },
  ),
  command(
    "journey.evidence.save",
    "Save Journey evidence",
    "POST",
    "/journeys/:journeyId/evidence",
    {
      category: "evidence",
    },
  ),
  query("journey.document.get", "Get Journey document", "/journeys/:journeyId/document", {
    category: "authoring",
    output: revisionedJourneyParser,
  }),
  command(
    "journey.document.update",
    "Update Journey document",
    "PUT",
    "/journeys/:journeyId/document",
    {
      category: "authoring",
      output: revisionedJourneyParser,
    },
  ),
  command(
    "collaboration.document.bootstrap",
    "Bootstrap collaborative Journey",
    "POST",
    "/journeys/:journeyId/collaboration/bootstrap",
    {
      category: "authoring",
      input: collaborationJourneyInputParser,
      output: collaborationDocumentResponseParser,
      idempotency: "inherent",
    },
  ),
  command(
    "collaboration.document.sync",
    "Sync collaborative Journey",
    "POST",
    "/journeys/:journeyId/collaboration/sync",
    {
      category: "authoring",
      input: collaborationSyncInputParser,
      output: collaborationDocumentResponseParser,
      idempotency: "inherent",
    },
  ),
  command(
    "collaboration.update.append",
    "Append collaborative Journey update",
    "POST",
    "/journeys/:journeyId/collaboration/updates",
    {
      category: "authoring",
      input: collaborationAppendInputParser,
      output: collaborationAppendResponseParser,
      idempotency: "required",
    },
  ),
  query(
    "collaboration.status.get",
    "Get collaborative Journey status",
    "/journeys/:journeyId/collaboration/status",
    {
      category: "authoring",
      input: collaborationJourneyInputParser,
      output: collaborationDocumentResponseParser,
    },
  ),
  query(
    "collaboration.document.export",
    "Export collaborative Journey",
    "/journeys/:journeyId/collaboration/export",
    {
      category: "authoring",
      input: collaborationJourneyInputParser,
      output: collaborationDocumentResponseParser,
    },
  ),
  command(
    "collaboration.document.repair",
    "Repair collaborative Journey storage",
    "POST",
    "/journeys/:journeyId/collaboration/repair",
    {
      category: "authoring",
      input: collaborationJourneyInputParser,
      output: collaborationDocumentResponseParser,
      idempotency: "inherent",
      confirmation: "confirm",
    },
  ),
  command(
    "collaboration.awareness.publish",
    "Publish collaboration awareness",
    "PUT",
    "/journeys/:journeyId/collaboration/awareness",
    {
      category: "authoring",
      input: collaborationAwarenessPublishParser,
      output: collaborationAwarenessResponseParser,
      idempotency: "inherent",
    },
  ),
  query(
    "collaboration.awareness.list",
    "List collaboration awareness",
    "/journeys/:journeyId/collaboration/awareness",
    {
      category: "authoring",
      input: collaborationJourneyInputParser,
      output: collaborationAwarenessListParser,
    },
  ),
  command(
    "collaboration.awareness.remove",
    "Remove collaboration awareness",
    "DELETE",
    "/journeys/:journeyId/collaboration/awareness",
    {
      category: "authoring",
      input: collaborationJourneyInputParser,
      output: collaborationAwarenessRemoveParser,
      idempotency: "inherent",
      confirmation: "none",
    },
  ),
  query("authoring.session.list", "List Authoring Sessions", "/authoring-sessions", {
    category: "authoring",
    input: emptyInputParser,
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
  query("collection.list", "List Collections", "/collections", {
    category: "authoring",
    input: emptyInputParser,
    output: arrayFieldParser("Collections response", "collections"),
  }),
  query("collection.get", "Get Collection", "/collections/:collectionId", {
    category: "authoring",
    output: objectFieldParser("Collection response", "collection"),
  }),
  command("collection.create", "Create Collection", "POST", "/collections", {
    category: "authoring",
    input: revisionWriteInputParser,
    output: objectFieldParser("Collection response", "collection"),
  }),
  command("collection.update", "Update Collection", "PUT", "/collections/:collectionId", {
    category: "authoring",
    input: revisionWriteInputParser,
    output: objectFieldParser("Collection response", "collection"),
  }),
  command("collection.delete", "Delete Collection", "DELETE", "/collections/:collectionId", {
    category: "authoring",
    output: okParser,
  }),
  command(
    "collection.restore",
    "Restore Collection",
    "POST",
    "/collections/:collectionId/restore",
    {
      category: "authoring",
      confirmation: "confirm",
      output: objectFieldParser("Collection response", "collection"),
    },
  ),
  command("collection.run", "Run Collection", "POST", "/collections/:collectionId/run", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
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
  command("discovery.promote", "Promote Discovery path", "POST", "/discovery/:sessionId/promote", {
    category: "discovery",
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
  command("job.graph-path.start", "Run Journey path", "POST", "/jobs/graph-path", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command("job.matrix.start", "Run job matrix", "POST", "/jobs/matrix", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
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
  query("run.list", "List Runs", "/runs", { category: "execution", output: runsParser }),
  query("run.get", "Get Run", "/runs/:runId", {
    category: "evidence",
    input: runIdInputParser,
  }),
  query("run.evidence.get", "Get Run Evidence", "/runs/:runId/evidence", {
    category: "evidence",
    input: runEvidenceInputParser,
  }),
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
  command("run.pin.update", "Pin Run", "POST", "/runs/:runId/pin", { category: "execution" }),
  command("step.run", "Run one Journey step", "POST", "/step/run", {
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
