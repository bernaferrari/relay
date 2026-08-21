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
  | "worker-saturated";

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
  "workerId" | "capacity" | "active" | "queued" | "activeTargets" | "queuedTargets"
>;

export type CampaignCapacityWorkerPlan = {
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
