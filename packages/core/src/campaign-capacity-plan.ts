import type {
  CampaignCapacityBudgetEstimate,
  CampaignCapacityExcludedTarget,
  CampaignCapacityExclusionReason,
  CampaignCapacityHostPlan,
  CampaignCapacityPlan,
  CampaignCapacityPlanInput,
  CampaignCapacitySlot,
  CampaignCapacityTarget,
  CampaignCapacityWorker,
  CampaignCapacityWorkerPlan,
} from "@relay/protocol";

type HostState = NonNullable<CampaignCapacityWorker["host"]> & {
  key: string;
  displayId: string;
};

type WorkerState = CampaignCapacityWorker & {
  key: string;
  displayId: string;
  host?: HostState;
};

type Candidate = CampaignCapacityTarget & { targetId: string; worker: WorkerState };

const ASSUMPTIONS = [
  "Each work item is independently executable on any assigned target slot.",
  "Each physical target supplies at most one slot; work remains serial on that target.",
  "Mixed-platform deadline estimates require an explicit workItemsByPlatform partition; aggregate slots never let Android capacity stand in for iOS capacity.",
  "Parallel estimates assume equal work-item durations and do not include installation or recovery time unless the caller reserves them outside this pure planner.",
  "The serial estimate is a theoretical one-slot baseline, not authority to use an excluded target.",
  "Additional slots still need fresh, available, unleased targets with observed free worker and host capacity after active and queued work reserve their lanes.",
  "Leased, stale, unavailable, active, queued, duplicate, unknown-worker, and worker-saturated targets are never assigned.",
  "A shared host/provider ceiling is applied across otherwise independent physical target lanes.",
] as const;

const PLATFORM_ORDER = ["android", "ios", "browser"] as const;

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function requireWorkItems(value: number): void {
  if (!isSafeNonNegativeInteger(value)) {
    throw new Error("Campaign workItems must be a non-negative safe integer");
  }
}

function requireDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer in milliseconds`);
  }
}

function requireBudget(value: number): void {
  if (!isSafeNonNegativeInteger(value)) {
    throw new Error("Campaign timeBudgetMs must be a non-negative safe integer in milliseconds");
  }
}

function checkedProduct(left: number, right: number): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new Error("Campaign duration estimate exceeds the safe integer range");
  }
  return product;
}

function sameHostFacts(left: HostState, right: HostState): boolean {
  return (
    left.capacity === right.capacity && left.active === right.active && left.queued === right.queued
  );
}

function workersById(workers: readonly CampaignCapacityWorker[]): Map<string, WorkerState> {
  const result = new Map<string, WorkerState>();
  const hosts = new Map<string, HostState>();
  for (const worker of workers) {
    const workerId = worker.workerId.trim();
    if (!workerId) throw new Error("Campaign worker ids cannot be empty");
    if (result.has(workerId)) throw new Error(`Campaign worker ${workerId} is duplicated`);
    if (!Number.isSafeInteger(worker.capacity) || worker.capacity < 1) {
      throw new Error(`Campaign worker ${workerId} must have positive capacity`);
    }
    if (!isSafeNonNegativeInteger(worker.active)) {
      throw new Error(`Campaign worker ${workerId} must have a non-negative active count`);
    }
    if (!isSafeNonNegativeInteger(worker.queued)) {
      throw new Error(`Campaign worker ${workerId} must have a non-negative queued count`);
    }
    let host: HostState | undefined;
    if (worker.host) {
      const hostId = worker.host.workerId.trim();
      if (!hostId) throw new Error(`Campaign worker ${workerId} has an empty host id`);
      if (!Number.isSafeInteger(worker.host.capacity) || worker.host.capacity < 1) {
        throw new Error(`Campaign host ${hostId} must have positive capacity`);
      }
      if (!isSafeNonNegativeInteger(worker.host.active)) {
        throw new Error(`Campaign host ${hostId} must have a non-negative active count`);
      }
      if (!isSafeNonNegativeInteger(worker.host.queued)) {
        throw new Error(`Campaign host ${hostId} must have a non-negative queued count`);
      }
      const candidate: HostState = {
        ...worker.host,
        workerId: hostId,
        key: `host:${hostId}`,
        displayId: hostId,
      };
      const established = hosts.get(hostId);
      if (established && !sameHostFacts(established, candidate)) {
        throw new Error(`Campaign host ${hostId} has inconsistent observed capacity facts`);
      }
      host = established ?? candidate;
      hosts.set(hostId, host);
    }
    const { host: _untypedHost, ...workerWithoutHost } = worker;
    result.set(workerId, {
      ...workerWithoutHost,
      key: `explicit:${workerId}`,
      displayId: workerId,
      workerId,
      ...(host ? { host } : {}),
    });
  }
  return result;
}

function addExcluded(
  excluded: CampaignCapacityExcludedTarget[],
  target: CampaignCapacityTarget,
  reasons: CampaignCapacityExclusionReason[],
): void {
  excluded.push({ targetId: target.targetId.trim(), platform: target.platform, reasons });
}

function workerFor(
  target: CampaignCapacityTarget,
  workers: Map<string, WorkerState>,
): WorkerState | undefined {
  const workerId = target.workerId.trim();
  if (!workerId) return undefined;
  return workers.get(workerId);
}

function estimateDuration(workItems: number, durationMs: number, slots: number): number | null {
  if (workItems === 0) return 0;
  if (slots < 1) return null;
  return checkedProduct(Math.ceil(workItems / slots), durationMs);
}

function estimateBudget(input: {
  workItems: number;
  estimatedWorkItemDurationMs: number;
  slots: number;
  timeBudgetMs: number;
}): CampaignCapacityBudgetEstimate {
  const minimumPossibleDurationMs = input.workItems === 0 ? 0 : input.estimatedWorkItemDurationMs;
  if (input.workItems === 0) {
    return {
      timeBudgetMs: input.timeBudgetMs,
      achievableWithCurrentCapacity: true,
      requiredIndependentTargetSlots: 0,
      additionalIndependentTargetSlots: 0,
      minimumPossibleDurationMs,
    };
  }
  const batchesWithinBudget = Math.floor(input.timeBudgetMs / input.estimatedWorkItemDurationMs);
  if (batchesWithinBudget < 1) {
    return {
      timeBudgetMs: input.timeBudgetMs,
      achievableWithCurrentCapacity: false,
      requiredIndependentTargetSlots: null,
      additionalIndependentTargetSlots: null,
      minimumPossibleDurationMs,
    };
  }
  const requiredIndependentTargetSlots = Math.ceil(input.workItems / batchesWithinBudget);
  return {
    timeBudgetMs: input.timeBudgetMs,
    achievableWithCurrentCapacity: input.slots >= requiredIndependentTargetSlots,
    requiredIndependentTargetSlots,
    additionalIndependentTargetSlots: Math.max(0, requiredIndependentTargetSlots - input.slots),
    minimumPossibleDurationMs,
  };
}

function workItemsByPlatform(
  input: CampaignCapacityPlanInput,
): Map<CampaignCapacityTarget["platform"], number> | undefined {
  if (!input.workItemsByPlatform) return undefined;
  for (const platform of Object.keys(input.workItemsByPlatform)) {
    if (!PLATFORM_ORDER.includes(platform as (typeof PLATFORM_ORDER)[number])) {
      throw new Error(`Campaign platform ${platform} is not supported`);
    }
  }
  const values = new Map<CampaignCapacityTarget["platform"], number>();
  let total = 0;
  for (const platform of PLATFORM_ORDER) {
    const workItems = input.workItemsByPlatform[platform];
    if (workItems === undefined) continue;
    requireWorkItems(workItems);
    total += workItems;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Campaign platform work estimate exceeds the safe integer range");
    }
    values.set(platform, workItems);
  }
  if (total !== input.workItems) {
    throw new Error("Campaign workItemsByPlatform must add up to workItems");
  }
  return values;
}

function combinedPlatformBudget(
  plans: Array<{ workItems: number; budget: CampaignCapacityBudgetEstimate }>,
  timeBudgetMs: number,
): CampaignCapacityBudgetEstimate {
  const minimumPossibleDurationMs = Math.max(
    0,
    ...plans.map((plan) => plan.budget.minimumPossibleDurationMs),
  );
  if (plans.some((plan) => plan.budget.requiredIndependentTargetSlots === null)) {
    return {
      timeBudgetMs,
      achievableWithCurrentCapacity: false,
      requiredIndependentTargetSlots: null,
      additionalIndependentTargetSlots: null,
      minimumPossibleDurationMs,
    };
  }
  const requiredIndependentTargetSlots = plans.reduce(
    (total, plan) => total + (plan.budget.requiredIndependentTargetSlots ?? 0),
    0,
  );
  const additionalIndependentTargetSlots = plans.reduce(
    (total, plan) => total + (plan.budget.additionalIndependentTargetSlots ?? 0),
    0,
  );
  return {
    timeBudgetMs,
    achievableWithCurrentCapacity: plans.every((plan) => plan.budget.achievableWithCurrentCapacity),
    requiredIndependentTargetSlots,
    additionalIndependentTargetSlots,
    minimumPossibleDurationMs,
  };
}

/**
 * Compute safe, immediately schedulable target slots without acquiring a
 * lease, mutating a queue, or assuming a remote device-farm provider.
 */
export function planCampaignCapacity(input: CampaignCapacityPlanInput): CampaignCapacityPlan {
  requireWorkItems(input.workItems);
  requireDuration(input.estimatedWorkItemDurationMs, "Campaign estimatedWorkItemDurationMs");
  if (input.timeBudgetMs !== undefined) {
    requireBudget(input.timeBudgetMs);
  }
  const platformWorkItems = workItemsByPlatform(input);

  const workers = workersById(input.workers);
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const target of input.targets) {
    const targetId = target.targetId.trim();
    if (targetId && seenIds.has(targetId)) duplicateIds.add(targetId);
    if (targetId) seenIds.add(targetId);
  }

  const excludedTargets: CampaignCapacityExcludedTarget[] = [];
  const candidatesByWorker = new Map<string, Candidate[]>();
  const workerStates = new Map<string, WorkerState>();

  for (const target of input.targets) {
    const targetId = target.targetId.trim();
    const reasons: CampaignCapacityExclusionReason[] = [];
    if (!targetId) reasons.push("invalid-target");
    if (targetId && duplicateIds.has(targetId)) reasons.push("duplicate-target");
    if (target.availability === "unavailable") reasons.push("unavailable");
    if (target.availability === "stale") reasons.push("stale");
    if (target.lease === "leased") reasons.push("leased");
    const normalized = { ...target, targetId };
    const worker = targetId ? workerFor(normalized, workers) : undefined;
    if (!worker) reasons.push("worker-unknown");
    if (worker?.activeTargets.includes(targetId)) reasons.push("worker-active");
    if (worker?.queuedTargets.includes(targetId)) reasons.push("worker-queued");
    if (reasons.length > 0 || !worker) {
      addExcluded(excludedTargets, normalized, reasons);
      continue;
    }
    workerStates.set(worker.key, worker);
    const candidates = candidatesByWorker.get(worker.key) ?? [];
    candidates.push({ ...normalized, worker });
    candidatesByWorker.set(worker.key, candidates);
  }

  const slots: CampaignCapacitySlot[] = [];
  const slotCountByWorker = new Map<string, number>();
  const freeCapacityByWorker = new Map<string, number>();
  const hostStates = new Map<string, HostState>();
  const freeCapacityByHost = new Map<string, number>();
  const slotCountByHost = new Map<string, number>();
  for (const worker of workerStates.values()) {
    // A queued item has already claimed a future turn on this worker. It has
    // no bounded drain time here, so an immediate/deadline-aware plan must
    // reserve that capacity instead of promising it to a new campaign.
    freeCapacityByWorker.set(
      worker.key,
      Math.max(0, worker.capacity - worker.active - worker.queued),
    );
    if (worker.host) {
      hostStates.set(worker.host.key, worker.host);
      if (!freeCapacityByHost.has(worker.host.key)) {
        freeCapacityByHost.set(
          worker.host.key,
          Math.max(0, worker.host.capacity - worker.host.active - worker.host.queued),
        );
      }
    }
  }

  // Ordering is deliberately global rather than worker-first. A shared host
  // ceiling must not let whichever worker map happened to be iterated first
  // silently consume all capacity in a different order on another process.
  const candidates = [...candidatesByWorker.values()]
    .flat()
    .sort((left, right) => left.targetId.localeCompare(right.targetId));
  for (const candidate of candidates) {
    const worker = candidate.worker;
    const workerFree = freeCapacityByWorker.get(worker.key) ?? 0;
    if (workerFree < 1) {
      addExcluded(excludedTargets, candidate, ["worker-saturated"]);
      continue;
    }
    const hostFree = worker.host ? (freeCapacityByHost.get(worker.host.key) ?? 0) : undefined;
    if (hostFree !== undefined && hostFree < 1) {
      addExcluded(excludedTargets, candidate, ["host-saturated"]);
      continue;
    }
    slots.push({
      targetId: candidate.targetId,
      platform: candidate.platform,
      workerId: worker.displayId,
    });
    freeCapacityByWorker.set(worker.key, workerFree - 1);
    slotCountByWorker.set(worker.key, (slotCountByWorker.get(worker.key) ?? 0) + 1);
    if (worker.host && hostFree !== undefined) {
      freeCapacityByHost.set(worker.host.key, hostFree - 1);
      slotCountByHost.set(worker.host.key, (slotCountByHost.get(worker.host.key) ?? 0) + 1);
    }
  }

  const workerPlans: CampaignCapacityWorkerPlan[] = [...workerStates.values()].map((worker) => ({
    workerId: worker.displayId,
    capacity: worker.capacity,
    active: worker.active,
    queued: worker.queued,
    freeCapacity: Math.max(0, worker.capacity - worker.active - worker.queued),
    slotCount: slotCountByWorker.get(worker.key) ?? 0,
  }));
  const hostPlans: CampaignCapacityHostPlan[] = [...hostStates.values()].map((host) => ({
    workerId: host.displayId,
    capacity: host.capacity,
    active: host.active,
    queued: host.queued,
    freeCapacity: Math.max(0, host.capacity - host.active - host.queued),
    slotCount: slotCountByHost.get(host.key) ?? 0,
  }));

  slots.sort((left, right) => left.targetId.localeCompare(right.targetId));
  excludedTargets.sort((left, right) => left.targetId.localeCompare(right.targetId));
  const serialDurationMs = estimateDuration(input.workItems, input.estimatedWorkItemDurationMs, 1)!;
  const platformNames = new Set(input.targets.map((target) => target.platform));
  for (const platform of platformWorkItems?.keys() ?? []) platformNames.add(platform);
  const platforms = [...platformNames]
    .sort((left, right) => PLATFORM_ORDER.indexOf(left) - PLATFORM_ORDER.indexOf(right))
    .map((platform) => {
      const scheduledSlots = slots.filter((slot) => slot.platform === platform).length;
      const workItems = platformWorkItems?.get(platform);
      const serial =
        workItems === undefined
          ? undefined
          : {
              slots: workItems === 0 ? 0 : 1,
              estimatedDurationMs: estimateDuration(
                workItems,
                input.estimatedWorkItemDurationMs,
                1,
              )!,
            };
      const parallel =
        workItems === undefined
          ? undefined
          : {
              slots: scheduledSlots,
              estimatedDurationMs: estimateDuration(
                workItems,
                input.estimatedWorkItemDurationMs,
                scheduledSlots,
              ),
            };
      const budget =
        workItems === undefined || input.timeBudgetMs === undefined
          ? undefined
          : estimateBudget({
              workItems,
              estimatedWorkItemDurationMs: input.estimatedWorkItemDurationMs,
              slots: scheduledSlots,
              timeBudgetMs: input.timeBudgetMs,
            });
      return {
        platform,
        scheduledSlots,
        excludedTargets: excludedTargets.filter((target) => target.platform === platform).length,
        ...(workItems === undefined ? {} : { workItems }),
        ...(serial ? { serial } : {}),
        ...(parallel ? { parallel } : {}),
        ...(budget ? { budget } : {}),
      };
    });
  const parallelDurationMs = platformWorkItems
    ? Math.max(
        0,
        ...platforms.map(
          (platform) => platform.parallel?.estimatedDurationMs ?? Number.POSITIVE_INFINITY,
        ),
      )
    : estimateDuration(input.workItems, input.estimatedWorkItemDurationMs, slots.length);
  const budget =
    input.timeBudgetMs === undefined
      ? undefined
      : platformWorkItems
        ? combinedPlatformBudget(
            platforms.flatMap((platform) =>
              platform.budget && platform.workItems !== undefined
                ? [{ workItems: platform.workItems, budget: platform.budget }]
                : [],
            ),
            input.timeBudgetMs,
          )
        : estimateBudget({
            workItems: input.workItems,
            estimatedWorkItemDurationMs: input.estimatedWorkItemDurationMs,
            slots: slots.length,
            timeBudgetMs: input.timeBudgetMs,
          });

  return {
    workItems: input.workItems,
    estimatedWorkItemDurationMs: input.estimatedWorkItemDurationMs,
    slots,
    excludedTargets,
    workers: workerPlans.sort((left, right) => left.workerId.localeCompare(right.workerId)),
    hosts: hostPlans.sort((left, right) => left.workerId.localeCompare(right.workerId)),
    platforms,
    serial: { slots: input.workItems === 0 ? 0 : 1, estimatedDurationMs: serialDurationMs },
    parallel: {
      slots: slots.length,
      estimatedDurationMs: Number.isFinite(parallelDurationMs) ? parallelDurationMs : null,
      idealSpeedup:
        serialDurationMs === 0 ||
        parallelDurationMs === null ||
        !Number.isFinite(parallelDurationMs)
          ? null
          : serialDurationMs / parallelDurationMs,
    },
    ...(budget ? { budget } : {}),
    assumptions: [...ASSUMPTIONS],
  };
}
