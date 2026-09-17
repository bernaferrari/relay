import type { TargetWorkerStatus } from "./target-runtime.js";
import type { ExecutionQueueDurationQuote, ExecutionQueueMemberQuote } from "./execution-queue.js";
import type { RouteVariantConfigurationQuote } from "./route-variant-configuration.js";

/** A current scheduling fact about a concrete target, not a provider promise. */
export type CampaignCapacityTargetAvailability = "available" | "unavailable" | "stale";

/** An active exclusive lease always wins over an otherwise healthy target. */
export type CampaignCapacityTargetLease = "available" | "leased";

/**
 * The minimum scheduling facts needed to plan independent campaign work.
 *
 * `stale` is deliberately distinct from `unavailable`: a stale observation
 * may still be useful for diagnosis, but it cannot be assigned work until a
 * caller refreshes it. A target can fill at most one slot, regardless of its
 * host or provider.
 */
export type CampaignCapacityTarget = {
  targetId: string;
  platform: "android" | "ios" | "browser";
  availability: CampaignCapacityTargetAvailability;
  lease: CampaignCapacityTargetLease;
  /**
   * Actual host/worker identity. The planner never infers this from a target
   * serial, because doing so would overstate capacity for several devices
   * attached to one local host.
   */
  workerId: string;
};

export type CampaignCapacityExclusionReason =
  | "invalid-target"
  | "duplicate-target"
  | "unavailable"
  | "stale"
  | "leased"
  | "worker-unknown"
  | "worker-active"
  | "worker-queued"
  | "worker-saturated"
  | "host-saturated";

export type CampaignCapacityExcludedTarget = {
  targetId: string;
  platform: CampaignCapacityTarget["platform"];
  reasons: CampaignCapacityExclusionReason[];
};

/** One currently schedulable, single-target execution slot. */
export type CampaignCapacitySlot = {
  targetId: string;
  platform: CampaignCapacityTarget["platform"];
  workerId: string;
};

/** Capacity observed from an existing local/hybrid worker, with no mutation. */
export type CampaignCapacityWorker = Pick<
  TargetWorkerStatus,
  "workerId" | "capacity" | "active" | "queued" | "activeTargets" | "queuedTargets" | "host"
>;

export type CampaignCapacityWorkerPlan = {
  workerId: string;
  capacity: number;
  active: number;
  queued: number;
  freeCapacity: number;
  slotCount: number;
};

/** A shared local-host/provider ceiling observed across one or more target lanes. */
export type CampaignCapacityHostPlan = {
  workerId: string;
  capacity: number;
  active: number;
  queued: number;
  freeCapacity: number;
  slotCount: number;
};

/** Per-platform capacity makes mixed iOS/Android plans inspectable at a glance. */
export type CampaignCapacityPlatformPlan = {
  platform: CampaignCapacityTarget["platform"];
  scheduledSlots: number;
  excludedTargets: number;
  /** Present only when the caller explicitly partitions work by platform.
   * A mixed Android/iOS campaign must not borrow an Android slot for iOS. */
  workItems?: number;
  serial?: CampaignCapacityTimeEstimate;
  parallel?: CampaignCapacityTimeEstimate;
  budget?: CampaignCapacityBudgetEstimate;
};

export type CampaignCapacityTimeEstimate = {
  slots: number;
  estimatedDurationMs: number | null;
};

export type CampaignCapacityBudgetEstimate = {
  timeBudgetMs: number;
  achievableWithCurrentCapacity: boolean;
  /**
   * The number of independent target slots needed for the estimate. A null
   * value means one indivisible work item already exceeds the time budget.
   */
  requiredIndependentTargetSlots: number | null;
  /** Missing slots after the currently schedulable slots are counted. */
  additionalIndependentTargetSlots: number | null;
  minimumPossibleDurationMs: number;
};

export type CampaignCapacityPlan = {
  workItems: number;
  estimatedWorkItemDurationMs: number;
  slots: CampaignCapacitySlot[];
  excludedTargets: CampaignCapacityExcludedTarget[];
  workers: CampaignCapacityWorkerPlan[];
  /** Aggregate ceilings applied after each physical target lane is considered. */
  hosts: CampaignCapacityHostPlan[];
  platforms: CampaignCapacityPlatformPlan[];
  serial: CampaignCapacityTimeEstimate;
  parallel: CampaignCapacityTimeEstimate & { idealSpeedup: number | null };
  budget?: CampaignCapacityBudgetEstimate;
  /** Separate Fast UI / Live output / Stateful-survival duration quotes when
   * the caller declared queue members. Never a three-minute workbook promise. */
  queueQuotes?: ExecutionQueueDurationQuote[];
  /** Android vs iOS vs web dest-ends as separate configurations. Captions
   * are not one Test covering three platforms by name. */
  routeVariantConfigurations?: RouteVariantConfigurationQuote[];
  /** Explicit estimator limits so consumers do not mistake this for a farm SLA. */
  assumptions: string[];
};

/**
 * Pure campaign planning input. A work item must be independently executable
 * on any returned slot (for example, one locale/run on one target).
 */
export type CampaignCapacityPlanInput = {
  targets: readonly CampaignCapacityTarget[];
  /** Current worker capacity and occupancy for every target's workerId. */
  workers: readonly CampaignCapacityWorker[];
  workItems: number;
  /**
   * Required for an honest mixed-platform deadline estimate. The values must
   * add up to `workItems`; each platform's work can use only its own slots.
   */
  workItemsByPlatform?: Partial<Record<CampaignCapacityTarget["platform"], number>>;
  estimatedWorkItemDurationMs: number;
  timeBudgetMs?: number;
  /** Optional per-item queue membership so capacity JSON can quote Fast UI,
   * Live output, and Stateful/survival separately. */
  queueMembers?: readonly ExecutionQueueMemberQuote[];
};

/** The target selector used by the local-device preflight. It stays explicit
 * so a missing serial can be reported against the requested platform rather
 * than guessed from its text. */
export type LocalCampaignCapacityTargetInput = {
  targetId: string;
  platform: "android" | "ios" | "browser";
};

/** The source of one duration estimate. A supplied estimate is useful for
 * rough sizing, but is never equivalent to an observed service-level result. */
export type CampaignCapacityDurationProvenance = "observed-p50" | "observed-p95" | "supplied";

export type CampaignCapacityDurationInput = {
  /** Duration of one independently executable work item, excluding campaign headroom. */
  workItemDurationMs: number;
  provenance: CampaignCapacityDurationProvenance;
  /** Required for observed p50/p95 values. */
  observedAt?: number;
  /** Required for observed p50/p95 values. */
  sampleCount?: number;
  /** Required for observed p50/p95 values; makes measurement freshness explicit. */
  maxAgeMs?: number;
};

/**
 * The immutable identity of the work represented by a timing measurement.
 * A platform-wide average is deliberately not this: deadline admission needs
 * to know both the physical lane and the Test/action which produced a sample.
 */
export type CampaignCapacityDurationCohort = {
  targetId: string;
  platform: "android" | "ios" | "browser";
  testId: string;
  action: string;
};

/** A measured duration is the only kind that can prove a deadline. */
export type CampaignCapacityObservedDurationInput = CampaignCapacityDurationInput & {
  provenance: "observed-p50" | "observed-p95";
  observedAt: number;
  sampleCount: number;
  maxAgeMs: number;
};

/** Where the bounded timing cohort came from. It makes a serialized admission
 * independently reviewable without giving a platform aggregate more authority
 * than its concrete target/Test samples deserve. */
export type CampaignCapacityCohortDurationMeasurement = {
  estimator: "campaign-duration-estimate";
  recordSource: "persisted-runs" | "run-summaries" | "mixed-read-only-records";
  durationSource: "run-wall-clock" | "evidence-completion";
  /** Exact, de-duplicated terminal run ids used by the percentile calculation. */
  sampleIds: string[];
  observationWindow: { startedAt: number; finishedAt: number };
};

/**
 * A conservative duration candidate tied to one physical target and Test /
 * frozen action. Local deadline admission rejects anything that cannot be
 * matched to a selected cell's complete cohort key.
 */
export type CampaignCapacityCohortDurationEvidence = {
  schemaVersion: 1;
  cohort: CampaignCapacityDurationCohort;
  duration: CampaignCapacityObservedDurationInput;
  measurement: CampaignCapacityCohortDurationMeasurement;
};

/** A local device's app/process state changes quickly. Clients may request a
 * shorter freshness window, never a longer one that would over-promise a new
 * deadline from an old observation. The server enforces this shared bound. */
export const MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS = 60 * 60 * 1_000;

/** A bounded request for estimates derived only from completed, immutable
 * target/Test/action run cohorts. It is intentionally separate from capacity
 * admission: reading this evidence neither leases a target nor reserves a
 * scheduler slot. */
export type CampaignCapacityCohortDurationEstimateRequest = {
  cohorts: CampaignCapacityDurationCohort[];
  /** How long an observation remains eligible for a deadline proof. The
   * server applies a conservative policy ceiling in addition to this value. */
  maxAgeMs: number;
  /** Defaults to the estimator's conservative p95 cohort minimum. */
  minSamples?: number;
  /** Bounds the newest successful samples considered for each cohort. */
  maxSamples?: number;
  /** Which observed percentile should be materialized as admission evidence. */
  percentile?: "p50" | "p95";
  /** Wall-clock work is the safe default; evidence completion is available
   * only when every accepted run has sufficient immutable evidence. */
  durationSource?: "run-wall-clock" | "evidence-completion";
};

/** Public diagnostic for a read-only timing calculation. It carries enough
 * provenance to explain why an estimate is unavailable without exposing a
 * platform-wide substitute as deadline evidence. */
export type CampaignCapacityCohortDurationEstimate = {
  schemaVersion: 1;
  cohort: CampaignCapacityDurationCohort;
  checkedAt: number;
  status: "current" | "stale" | "insufficient-samples";
  minSamples: number;
  maxAgeMs: number;
  sampleCount: number;
  observedAt?: number;
  observationWindow?: { startedAt: number; finishedAt: number };
  candidates?: {
    p50: CampaignCapacityObservedDurationInput;
    p95: CampaignCapacityObservedDurationInput;
  };
  filtering: {
    recordSource: "persisted-runs" | "run-summaries" | "mixed-read-only-records";
    durationSource: "run-wall-clock" | "evidence-completion";
    totalRecords: number;
    acceptedBeforeSampleCap: number;
    excludedByReason: Partial<Record<string, number>>;
    sampleCap: number;
    omittedBySampleCap: number;
  };
  /** Directly serializable only when enough compatible persisted evidence
   * exists. Its sample ids are re-verified again at admission time. */
  evidence?: CampaignCapacityCohortDurationEvidence;
};

export type CampaignCapacityCohortDurationEstimateResponse = {
  checkedAt: number;
  estimates: CampaignCapacityCohortDurationEstimate[];
};

/** Read-only request for sizing independent local Android/iOS work. */
export type LocalCampaignCapacityPreflightInput = {
  targets: LocalCampaignCapacityTargetInput[];
  workItems: number;
  /** Every work item is explicitly assigned to its platform partition. */
  workItemsByPlatform: Partial<Record<"android" | "ios" | "browser", number>>;
  duration: CampaignCapacityDurationInput;
  /** Whole critical-path budget requested by the caller. */
  deadlineMs: number;
  /** Critical-path reserve for install/launch/setup, applied once to the campaign. */
  setupHeadroomMs?: number;
  /** Critical-path reserve for one recovery/repair path, applied once to the campaign. */
  recoveryHeadroomMs?: number;
  /** Optional per-item queue membership so capacity JSON can quote Fast UI,
   * Live output, and Stateful/survival separately. */
  queueMembers?: ExecutionQueueMemberQuote[];
};

export type LocalCampaignCapacityTargetReason =
  | "missing"
  | "platform-mismatch"
  | "offline"
  | "not-booted"
  | "developer-mode-disabled"
  | "developer-services-unavailable"
  | "stale-readiness";

/** The concrete local observation used to derive one planner target. */
export type LocalCampaignCapacityTargetFact = {
  targetId: string;
  requestedPlatform: "android" | "ios" | "browser";
  observedPlatform?: "android" | "ios" | "browser";
  availability: CampaignCapacityTargetAvailability;
  lease: CampaignCapacityTargetLease;
  workerId: string;
  /** A never-seen local lane has a deterministic one-target policy, but its
   * idle state is derived rather than read from the in-memory scheduler. */
  workerFact: "scheduler" | "derived-local-lane";
  reason?: LocalCampaignCapacityTargetReason;
};

export type CampaignCapacityMeasurementAssurance =
  | "measured-current"
  | "measurement-stale"
  | "supplied-estimate";

export type LocalCampaignCapacityDeadlineAssessment = {
  requestedMs: number;
  reservedHeadroomMs: number;
  workBudgetMs: number;
  /** Work duration plus the once-per-campaign critical-path reserve. */
  estimatedParallelDurationMs: number | null;
  capacity: "within-budget" | "outside-budget";
  assurance: CampaignCapacityMeasurementAssurance;
  /** True only for a current observed duration and presently available slots.
   * This remains a read-only preflight, never an admission or lease guarantee. */
  achievableWithCurrentCapacity: boolean;
};

/** A truthful local-device sizing result. It captures observations but never
 * leases, queues, reserves, or otherwise changes target state. */
export type LocalCampaignCapacityPreflight = {
  checkedAt: number;
  input: LocalCampaignCapacityPreflightInput;
  duration: CampaignCapacityDurationInput & {
    assurance: CampaignCapacityMeasurementAssurance;
  };
  targets: LocalCampaignCapacityTargetFact[];
  deadline: LocalCampaignCapacityDeadlineAssessment;
  plan: CampaignCapacityPlan;
  assumptions: string[];
};

/** A target-affine cell on one serial critical path. */
export type LocalCampaignCapacityCriticalPathWorkItem = {
  workItemId: string;
  evidence: CampaignCapacityCohortDurationEvidence;
};

/**
 * The deadline proof for one concrete target. Unlike the generic capacity
 * preflight, this keeps every Test/action measurement visible and sums them
 * on the target's serial lane.
 */
export type LocalCampaignCapacityTargetCriticalPathPreflight = {
  checkedAt: number;
  target: LocalCampaignCapacityTargetFact;
  criticalPath: {
    workItems: LocalCampaignCapacityCriticalPathWorkItem[];
    estimatedWorkDurationMs: number;
  };
  /** True only if this target survived the campaign-wide target/host capacity snapshot. */
  scheduled: boolean;
  deadline: LocalCampaignCapacityDeadlineAssessment;
  assumptions: string[];
};
