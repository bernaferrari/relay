import type {
  CampaignCapacityCohortDurationEvidence,
  LocalCampaignCapacityPreflight,
  LocalCampaignCapacityTargetCriticalPathPreflight,
} from "./campaign-capacity-plan.js";
import type { ExecutionTargetRef, LocalAgentDeviceExecutionTargetRef } from "./execution-target.js";
import type { SourceRevision } from "./source-revision.js";
import type { AuthoringTarget } from "./authoring.js";
import type { RepeatSpec, ResolvedRepeatSpec } from "./repeat-spec.js";

/**
 * Shared, serialized local-deadline request. Every selected target ×
 * Test/action cohort must contribute fresh immutable timing evidence; callers
 * must never reconstruct sample ids or fall back to a platform average.
 */
export type LocalCampaignAdmissionRequest = {
  deadlineMs: number;
  durationEvidence: CampaignCapacityCohortDurationEvidence[];
  setupHeadroomMs?: number;
  recoveryHeadroomMs?: number;
};

/** One independently staged local campaign case. The action is the stable
 * frozen Test identity (not a generated wrapper recipe id), so timing evidence
 * can survive variable values and recompilation without becoming anonymous. */
export type LocalCampaignAdmissionWorkItem = {
  id: string;
  target: LocalAgentDeviceExecutionTargetRef;
  testId: string;
  action: string;
};

/** Read-only generic admission check for any local campaign (Combine, locale
 * matrix, or a future device-farm adapter). It carries no lease intent. */
export type LocalCampaignAdmissionPreflightRequest = {
  workItems: LocalCampaignAdmissionWorkItem[];
  request: LocalCampaignAdmissionRequest;
};

export type LocalCampaignAdmissionPreflightResponse = {
  preflight: LocalCampaignCapacityPreflight;
  targetPreflights: LocalCampaignCapacityTargetCriticalPathPreflight[];
};

export type CombineCampaignCaseStatus =
  | "pending"
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "cancelled";

export type CombineCampaignStatus =
  | "pilot-running"
  | "ready-to-resume"
  | "needs-review"
  | "running"
  | "completed"
  | "completed-with-problems"
  | "cancelled";

export type CombineCampaignCase = {
  index: number;
  cellId: string;
  testId: string;
  world: string;
  values: Record<string, string>;
  targetProfileId: string;
  /**
   * Frozen per-cell execution location. Optional only for schema-v1 campaigns
   * written before target binding was introduced; those records fall back to
   * the legacy campaign-wide target during resume.
   */
  target?: ExecutionTargetRef;
  childIntentDigest: string;
  outerIntentDigest: string;
  wrapperGraphDigest: string;
  staticInputDigest: string;
  phase: "pilot" | "coverage";
  status: CombineCampaignCaseStatus;
  jobId?: string;
  /** Immutable Run evidence becomes available after the case is persisted. */
  runId?: string;
  /** Earlier immutable Runs retained when an explicitly reviewed resume
   * re-executes this exact frozen case tuple. */
  priorRunIds?: string[];
  error?: string;
};

/** Immutable workflow identity retained beside durable scheduling state. It
 * exists only so a client can adopt an already-started Repeat after losing its
 * local opaque reference; the App Map Test and Run evidence remain canonical. */
export type RepeatCampaignExecutionIdentity = {
  schemaVersion: 1;
  requestedAppMapRevision: number;
  executionAppMapRevision: number;
  testId: string;
  testPlanDigest: string;
  rootRecipeId: string;
  target: AuthoringTarget;
  /** Original user-facing request plus the exact ids resolved before control. */
  spec: RepeatSpec;
  resolved: ResolvedRepeatSpec;
  evidence: "visual" | "smoke";
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: string[] };
  pilotJobId: string;
  selectedCaseIds: string[];
};

/** Durable, bounded execution state for a saved Combine. App Map/Test data
 * remains the editable source of truth; this record only owns scheduling and
 * immutable lineage. */
export type CombineCampaign = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  ownerId?: string;
  appMapId: string;
  combineId: string;
  sourceRevision: number;
  latestRevision: number;
  /** Legacy campaign-wide target for schema-v1 records. New multi-target
   * campaigns put the authoritative target on every case instead. */
  target?: {
    kind: "device" | "browser";
    id: string;
    platform: "android" | "ios" | "browser";
  };
  status: CombineCampaignStatus;
  createdAt: number;
  updatedAt: number;
  cases: CombineCampaignCase[];
  lineage: Array<{
    kind: "created" | "resumed" | "cancelled";
    at: number;
    appMapRevision: number;
    actorId?: string;
    /** Present only when an approved repair reopened a causal subset. */
    causalRepairProposalIds?: string[];
    affectedCheckIds?: string[];
    affectedCellIds?: string[];
  }>;
  execution?: {
    selected?: Record<string, string[]>;
    selectedCellIds: string[];
    strategy?: "zip" | "cartesian" | "pairwise";
    seed: number;
    title?: string;
    repeat?: RepeatCampaignExecutionIdentity;
    /** Immutable admission evidence captured before any Combine jobs queued. */
    localAdmission?: {
      request: LocalCampaignAdmissionRequest;
      preflight: LocalCampaignCapacityPreflight;
      /** Per-bound-target checks preserve target affinity rather than
       * pretending that same-platform work can move between devices. */
      targetPreflights?: LocalCampaignCapacityTargetCriticalPathPreflight[];
      /** Exact local execution targets that were admitted. */
      targets: LocalAgentDeviceExecutionTargetRef[];
    };
  };
};
