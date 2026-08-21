import type {
  CampaignCapacityBudgetEstimate,
  CampaignCapacityExcludedTarget,
  CampaignCapacityExclusionReason,
  CampaignCapacityPlan,
  CampaignCapacityPlanInput,
  CampaignCapacitySlot,
  CampaignCapacityTarget,
  CampaignCapacityWorker,
  CampaignCapacityWorkerPlan,
} from "@relay/protocol";

type WorkerState = CampaignCapacityWorker & { key: string; displayId: string };

type Candidate = CampaignCapacityTarget & { targetId: string; worker: WorkerState };

const ASSUMPTIONS = [
  "Each work item is independently executable on any assigned target slot.",
  "Each physical target supplies at most one slot; work remains serial on that target.",
  "Mixed-platform deadline estimates require an explicit workItemsByPlatform partition; aggregate slots never let Android capacity stand in for iOS capacity.",
  "Parallel estimates assume equal work-item durations and do not include installation, queue drain, or recovery time.",
  "The serial estimate is a theoretical one-slot baseline, not authority to use an excluded target.",
  "Additional slots still need fresh, available, unleased targets with observed free worker capacity.",
  "Leased, stale, unavailable, active, queued, duplicate, unknown-worker, and worker-saturated targets are never assigned.",
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

function checkedProduct(left: number, right: number): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new Error("Campaign duration estimate exceeds the safe integer range");
  }
  return product;
}

function workersById(workers: readonly CampaignCapacityWorker[]): Map<string, WorkerState> {
  const result = new Map<string, WorkerState>();
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
    result.set(workerId, {
      ...worker,
      key: `explicit:${workerId}`,
      displayId: workerId,
      workerId,
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
    requireDuration(input.timeBudgetMs, "Campaign timeBudgetMs");
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
  const workerPlans: CampaignCapacityWorkerPlan[] = [];
  for (const [workerKey, candidates] of [...candidatesByWorker.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const worker = workerStates.get(workerKey)!;
    const freeCapacity = Math.max(0, worker.capacity - worker.active);
    const sorted = [...candidates].sort((left, right) =>
      left.targetId.localeCompare(right.targetId),
    );
    const assigned = sorted.slice(0, freeCapacity);
    for (const candidate of assigned) {
      slots.push({
        targetId: candidate.targetId,
        platform: candidate.platform,
        workerId: worker.displayId,
      });
    }
    for (const candidate of sorted.slice(freeCapacity)) {
      addExcluded(excludedTargets, candidate, ["worker-saturated"]);
    }
    workerPlans.push({
      workerId: worker.displayId,
      capacity: worker.capacity,
      active: worker.active,
      queued: worker.queued,
      freeCapacity,
      slotCount: assigned.length,
    });
  }

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
