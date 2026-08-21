import type { TargetWorkerStatus } from "./target-runtime.js";

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
};

/** The target selector used by the local-device preflight. It stays explicit
 * so a missing serial can be reported against the requested platform rather
 * than guessed from its text. */
export type LocalCampaignCapacityTargetInput = {
  targetId: string;
  platform: "android" | "ios";
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

/** Read-only request for sizing independent local Android/iOS work. */
export type LocalCampaignCapacityPreflightInput = {
  targets: LocalCampaignCapacityTargetInput[];
  workItems: number;
  /** Every work item is explicitly assigned to its platform partition. */
  workItemsByPlatform: Partial<Record<"android" | "ios", number>>;
  duration: CampaignCapacityDurationInput;
  /** Whole critical-path budget requested by the caller. */
  deadlineMs: number;
  /** Critical-path reserve for install/launch/setup, applied once to the campaign. */
  setupHeadroomMs?: number;
  /** Critical-path reserve for one recovery/repair path, applied once to the campaign. */
  recoveryHeadroomMs?: number;
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
  requestedPlatform: "android" | "ios";
  observedPlatform?: "android" | "ios";
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
