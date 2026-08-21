import type {
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityDurationInput,
  CampaignCapacityMeasurementAssurance,
  CampaignCapacityObservedDurationInput,
  CampaignCapacityTarget,
  CampaignCapacityWorker,
  DeviceLease,
  LocalCampaignCapacityCriticalPathWorkItem,
  LocalCampaignCapacityPreflight,
  LocalCampaignCapacityPreflightInput,
  LocalCampaignCapacityTargetFact,
  LocalCampaignCapacityTargetCriticalPathPreflight,
  LocalCampaignCapacityTargetInput,
  TargetWorkerStatus,
} from "@relay/protocol";
import { planCampaignCapacity } from "./campaign-capacity-plan.js";
import { defaultTargetWorkerAssignment } from "./target-worker.js";
import type { ListedDevice } from "./workspace-devices.js";

type LocalCampaignCapacityPreflightFacts = {
  devices: readonly ListedDevice[];
  leases: readonly DeviceLease[];
  workers: readonly TargetWorkerStatus[];
  at?: number;
};

export type PreflightLocalCampaignCapacityInput = LocalCampaignCapacityPreflightInput &
  LocalCampaignCapacityPreflightFacts;

export type PreflightLocalCampaignTargetCriticalPathInput = {
  target: LocalCampaignCapacityTargetInput;
  workItems: readonly LocalCampaignCapacityCriticalPathWorkItem[];
  deadlineMs: number;
  setupHeadroomMs?: number;
  recoveryHeadroomMs?: number;
  /** Target ids which survived the one campaign-wide worker/host snapshot.
   * Without this fence, two individually healthy iPads could both claim a
   * shared host slot that only one of them actually owns. */
  scheduledTargetIds?: readonly string[];
} & LocalCampaignCapacityPreflightFacts;

type TargetAvailability = Pick<LocalCampaignCapacityTargetFact, "availability" | "reason">;

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!isSafeNonNegativeInteger(value)) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function checkedSum(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error(`${label} exceeds the safe integer range`);
  return sum;
}

function normalizedDuration(
  rawDuration: CampaignCapacityDurationInput,
): CampaignCapacityDurationInput {
  const duration = { ...rawDuration };
  requirePositiveSafeInteger(duration.workItemDurationMs, "Campaign workItemDurationMs");
  if (
    duration.provenance !== "observed-p50" &&
    duration.provenance !== "observed-p95" &&
    duration.provenance !== "supplied"
  ) {
    throw new Error("Campaign duration provenance must be observed-p50, observed-p95, or supplied");
  }
  if (duration.provenance !== "supplied") {
    if (
      duration.observedAt === undefined ||
      duration.sampleCount === undefined ||
      duration.maxAgeMs === undefined
    ) {
      throw new Error("Observed campaign duration requires observedAt, sampleCount, and maxAgeMs");
    }
    requireNonNegativeSafeInteger(duration.observedAt, "Campaign duration observedAt");
    requirePositiveSafeInteger(duration.sampleCount, "Campaign duration sampleCount");
    requireNonNegativeSafeInteger(duration.maxAgeMs, "Campaign duration maxAgeMs");
  }
  return duration;
}

function normalizedInput(
  input: LocalCampaignCapacityPreflightInput,
): LocalCampaignCapacityPreflightInput {
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new Error("Campaign capacity preflight requires at least one target");
  }
  requireNonNegativeSafeInteger(input.workItems, "Campaign workItems");
  requireNonNegativeSafeInteger(input.deadlineMs, "Campaign deadlineMs");
  const setupHeadroomMs = input.setupHeadroomMs ?? 0;
  const recoveryHeadroomMs = input.recoveryHeadroomMs ?? 0;
  requireNonNegativeSafeInteger(setupHeadroomMs, "Campaign setupHeadroomMs");
  requireNonNegativeSafeInteger(recoveryHeadroomMs, "Campaign recoveryHeadroomMs");
  const duration = normalizedDuration(input.duration);
  let partitionedWorkItems = 0;
  for (const platform of ["android", "ios"] as const) {
    const count = input.workItemsByPlatform[platform];
    if (count === undefined) continue;
    requireNonNegativeSafeInteger(count, `Campaign ${platform} workItems`);
    partitionedWorkItems = checkedSum(
      partitionedWorkItems,
      count,
      "Campaign platform work estimate",
    );
  }
  if (partitionedWorkItems !== input.workItems) {
    throw new Error("Campaign workItemsByPlatform must add up to workItems");
  }
  for (const target of input.targets) {
    if (target.platform !== "android" && target.platform !== "ios") {
      throw new Error("Campaign targets must be Android or iOS");
    }
  }
  return {
    targets: input.targets.map((target) => ({ ...target, targetId: target.targetId.trim() })),
    workItems: input.workItems,
    workItemsByPlatform: { ...input.workItemsByPlatform },
    duration: { ...duration },
    deadlineMs: input.deadlineMs,
    ...(setupHeadroomMs ? { setupHeadroomMs } : {}),
    ...(recoveryHeadroomMs ? { recoveryHeadroomMs } : {}),
  };
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function normalizedCriticalPathEvidence(input: {
  target: LocalCampaignCapacityTargetInput;
  workItems: readonly LocalCampaignCapacityCriticalPathWorkItem[];
}): LocalCampaignCapacityCriticalPathWorkItem[] {
  if (!input.workItems.length) {
    throw new Error("Campaign target critical path requires at least one work item");
  }
  const targetId = nonEmptyString(input.target.targetId, "Campaign critical path targetId");
  if (input.target.platform !== "android" && input.target.platform !== "ios") {
    throw new Error("Campaign critical path target must be Android or iOS");
  }
  const seenItems = new Set<string>();
  return input.workItems.map((rawItem) => {
    const workItemId = nonEmptyString(rawItem.workItemId, "Campaign critical path workItemId");
    if (seenItems.has(workItemId)) {
      throw new Error(`Campaign target critical path work item ${workItemId} is duplicated`);
    }
    seenItems.add(workItemId);
    const evidence = structuredClone(rawItem.evidence) as CampaignCapacityCohortDurationEvidence;
    if (evidence.schemaVersion !== 1) {
      throw new Error("Campaign cohort duration evidence has an unsupported schema version");
    }
    const cohortTargetId = nonEmptyString(
      evidence.cohort?.targetId,
      "Campaign cohort duration targetId",
    );
    if (cohortTargetId !== targetId || evidence.cohort.platform !== input.target.platform) {
      throw new Error(
        `Campaign cohort duration for ${workItemId} does not match ${input.target.platform}:${targetId}`,
      );
    }
    nonEmptyString(evidence.cohort.testId, "Campaign cohort duration testId");
    nonEmptyString(evidence.cohort.action, "Campaign cohort duration action");
    const duration = normalizedDuration(evidence.duration);
    if (duration.provenance === "supplied") {
      throw new Error("Campaign target critical path requires observed cohort duration evidence");
    }
    const observedDuration: CampaignCapacityObservedDurationInput = {
      workItemDurationMs: duration.workItemDurationMs,
      provenance: duration.provenance,
      observedAt: duration.observedAt!,
      sampleCount: duration.sampleCount!,
      maxAgeMs: duration.maxAgeMs!,
    };
    const measurement = evidence.measurement;
    if (measurement?.estimator !== "campaign-duration-estimate") {
      throw new Error("Campaign cohort duration evidence must identify its estimator");
    }
    if (
      measurement.recordSource !== "persisted-runs" &&
      measurement.recordSource !== "run-summaries" &&
      measurement.recordSource !== "mixed-read-only-records"
    ) {
      throw new Error("Campaign cohort duration evidence has an unsupported record source");
    }
    if (
      measurement.durationSource !== "run-wall-clock" &&
      measurement.durationSource !== "evidence-completion"
    ) {
      throw new Error("Campaign cohort duration evidence has an unsupported duration source");
    }
    const sampleIds = measurement.sampleIds;
    if (!Array.isArray(sampleIds) || !sampleIds.length) {
      throw new Error("Campaign cohort duration evidence requires measured sample ids");
    }
    const normalizedSampleIds = sampleIds.map((sampleId) =>
      nonEmptyString(sampleId, "Campaign cohort duration sample id"),
    );
    if (new Set(normalizedSampleIds).size !== normalizedSampleIds.length) {
      throw new Error("Campaign cohort duration evidence sample ids must be unique");
    }
    if (observedDuration.sampleCount !== normalizedSampleIds.length) {
      throw new Error(
        "Campaign cohort duration evidence sampleCount must equal its measured sample ids",
      );
    }
    const window = measurement.observationWindow;
    if (!window)
      throw new Error("Campaign cohort duration evidence requires an observation window");
    requireNonNegativeSafeInteger(window.startedAt, "Campaign cohort observation window start");
    requireNonNegativeSafeInteger(window.finishedAt, "Campaign cohort observation window finish");
    if (window.finishedAt < window.startedAt || observedDuration.observedAt !== window.finishedAt) {
      throw new Error(
        "Campaign cohort duration observation window must end at its observed measurement time",
      );
    }
    return {
      workItemId,
      evidence: {
        ...evidence,
        cohort: {
          targetId: cohortTargetId,
          platform: evidence.cohort.platform,
          testId: evidence.cohort.testId.trim(),
          action: evidence.cohort.action.trim(),
        },
        duration: observedDuration,
        measurement: {
          ...measurement,
          sampleIds: normalizedSampleIds,
          observationWindow: { ...window },
        },
      },
    };
  });
}

function availabilityFor(
  requested: LocalCampaignCapacityPreflightInput["targets"][number],
  device: ListedDevice | undefined,
): TargetAvailability {
  if (!device) return { availability: "unavailable", reason: "missing" };
  if (device.platform !== requested.platform) {
    return { availability: "unavailable", reason: "platform-mismatch" };
  }
  if (device.connectionState === "offline" || device.connectionState === "unauthorized") {
    return { availability: "unavailable", reason: "offline" };
  }
  if (device.booted === false) return { availability: "unavailable", reason: "not-booted" };
  if (device.developerMode === "disabled") {
    return { availability: "unavailable", reason: "developer-mode-disabled" };
  }
  if (device.developerServicesAvailable === false) {
    return { availability: "unavailable", reason: "developer-services-unavailable" };
  }
  if (
    device.readiness &&
    [
      device.readiness.previewPixels,
      device.readiness.semanticControl,
      device.readiness.evidenceCapture,
    ].some((capability) => capability.freshness === "stale")
  ) {
    return { availability: "stale", reason: "stale-readiness" };
  }
  return { availability: "available" };
}

function activeLeaseByTarget(leases: readonly DeviceLease[], at: number): Map<string, DeviceLease> {
  return new Map(
    leases
      .filter((lease) => lease.status === "leased" && lease.expiresAt > at)
      .map((lease) => [lease.deviceSerial, lease]),
  );
}

function derivedWorker(
  targetId: string,
  platform: "android" | "ios",
  workers: readonly TargetWorkerStatus[],
): { worker: CampaignCapacityWorker; source: "scheduler" | "derived-local-lane" } {
  const assignment = defaultTargetWorkerAssignment({ targetId, platform });
  const observed = workers.find((worker) => worker.workerId === assignment.workerId);
  const observedHost = assignment.host
    ? workers.find((worker) => worker.host?.workerId === assignment.host!.workerId)?.host
    : undefined;
  return {
    worker: {
      workerId: assignment.workerId,
      capacity: observed?.capacity ?? assignment.capacity,
      active: observed?.active ?? 0,
      queued: observed?.queued ?? 0,
      activeTargets: [...(observed?.activeTargets ?? [])],
      queuedTargets: [...(observed?.queuedTargets ?? [])],
      ...(assignment.host
        ? {
            host: {
              workerId: assignment.host.workerId,
              capacity: assignment.host.capacity,
              active: observedHost?.active ?? 0,
              queued: observedHost?.queued ?? 0,
            },
          }
        : {}),
    },
    source: observed ? "scheduler" : "derived-local-lane",
  };
}

function durationAssurance(
  duration: CampaignCapacityDurationInput,
  at: number,
): CampaignCapacityMeasurementAssurance {
  if (duration.provenance === "supplied") return "supplied-estimate";
  const observedAt = duration.observedAt!;
  const maxAgeMs = duration.maxAgeMs!;
  return observedAt <= at && at - observedAt <= maxAgeMs ? "measured-current" : "measurement-stale";
}

/**
 * Converts one freshly-read local device/lease/scheduler snapshot into the
 * existing pure capacity plan. It is deliberately read-only: callers receive
 * an estimate and must still perform all-or-nothing lease admission later.
 */
export function preflightLocalCampaignCapacity(
  rawInput: PreflightLocalCampaignCapacityInput,
): LocalCampaignCapacityPreflight {
  const at = rawInput.at ?? Date.now();
  requireNonNegativeSafeInteger(at, "Campaign preflight time");
  const input = normalizedInput(rawInput);
  const reservedHeadroomMs = checkedSum(
    input.setupHeadroomMs ?? 0,
    input.recoveryHeadroomMs ?? 0,
    "Campaign headroom",
  );
  const workBudgetMs = Math.max(0, input.deadlineMs - reservedHeadroomMs);
  const devicesBySerial = new Map(rawInput.devices.map((device) => [device.serial, device]));
  const activeLeases = activeLeaseByTarget(rawInput.leases, at);
  const workersById = new Map<string, CampaignCapacityWorker>();
  const targets: CampaignCapacityTarget[] = [];
  const targetFacts: LocalCampaignCapacityTargetFact[] = [];

  for (const requested of input.targets) {
    const device = devicesBySerial.get(requested.targetId);
    const availability = availabilityFor(requested, device);
    const worker = derivedWorker(requested.targetId, requested.platform, rawInput.workers);
    workersById.set(worker.worker.workerId, worker.worker);
    const lease = activeLeases.has(requested.targetId) ? "leased" : "available";
    targets.push({
      targetId: requested.targetId,
      platform: requested.platform,
      availability: availability.availability,
      lease,
      workerId: worker.worker.workerId,
    });
    targetFacts.push({
      targetId: requested.targetId,
      requestedPlatform: requested.platform,
      ...(device && (device.platform === "android" || device.platform === "ios")
        ? { observedPlatform: device.platform }
        : {}),
      availability: availability.availability,
      lease,
      workerId: worker.worker.workerId,
      workerFact: worker.source,
      ...(availability.reason ? { reason: availability.reason } : {}),
    });
  }

  const plan = planCampaignCapacity({
    targets,
    workers: [...workersById.values()],
    workItems: input.workItems,
    workItemsByPlatform: input.workItemsByPlatform,
    estimatedWorkItemDurationMs: input.duration.workItemDurationMs,
    timeBudgetMs: workBudgetMs,
  });
  const assurance = durationAssurance(input.duration, at);
  const estimatedParallelDurationMs =
    plan.parallel.estimatedDurationMs === null
      ? null
      : checkedSum(
          plan.parallel.estimatedDurationMs,
          reservedHeadroomMs,
          "Campaign parallel duration",
        );
  const capacity = plan.budget!.achievableWithCurrentCapacity ? "within-budget" : "outside-budget";

  return {
    checkedAt: at,
    input,
    duration: { ...input.duration, assurance },
    targets: targetFacts,
    deadline: {
      requestedMs: input.deadlineMs,
      reservedHeadroomMs,
      workBudgetMs,
      estimatedParallelDurationMs,
      capacity,
      assurance,
      achievableWithCurrentCapacity:
        capacity === "within-budget" && assurance === "measured-current",
    },
    plan,
    assumptions: [
      "This preflight did not acquire a lease, reserve a target, or enqueue work.",
      "Each derived local lane has the scheduler's one-target capacity; observed scheduler facts replace that idle default when available.",
      "Queued or staged work reserves its target and shared-host capacity; its unbounded drain time is not included in a new deadline estimate.",
      "Setup and recovery headroom are reserved once on the campaign critical path, not multiplied by every work item.",
      "A supplied or stale duration can size work, but cannot make the deadline achievable with current capacity.",
    ],
  };
}

/**
 * Preflight the real serial critical path for one explicitly bound target.
 * The generic capacity planner remains the source of target/worker/host facts;
 * this layer deliberately sums heterogeneous Test/action cohorts instead of
 * pretending that a platform-wide average describes a slow device or path.
 */
export function preflightLocalCampaignTargetCriticalPath(
  rawInput: PreflightLocalCampaignTargetCriticalPathInput,
): LocalCampaignCapacityTargetCriticalPathPreflight {
  const checkedAt = rawInput.at ?? Date.now();
  requireNonNegativeSafeInteger(checkedAt, "Campaign target critical path preflight time");
  const target: LocalCampaignCapacityTargetInput = {
    targetId: nonEmptyString(rawInput.target.targetId, "Campaign critical path targetId"),
    platform: rawInput.target.platform,
  };
  if (target.platform !== "android" && target.platform !== "ios") {
    throw new Error("Campaign critical path target must be Android or iOS");
  }
  requireNonNegativeSafeInteger(rawInput.deadlineMs, "Campaign deadlineMs");
  const setupHeadroomMs = rawInput.setupHeadroomMs ?? 0;
  const recoveryHeadroomMs = rawInput.recoveryHeadroomMs ?? 0;
  requireNonNegativeSafeInteger(setupHeadroomMs, "Campaign setupHeadroomMs");
  requireNonNegativeSafeInteger(recoveryHeadroomMs, "Campaign recoveryHeadroomMs");
  const workItems = normalizedCriticalPathEvidence({ target, workItems: rawInput.workItems });
  const estimatedWorkDurationMs = workItems.reduce(
    (total, item) =>
      checkedSum(
        total,
        item.evidence.duration.workItemDurationMs,
        "Campaign target critical-path work duration",
      ),
    0,
  );
  const longestWorkItemDuration = Math.max(
    ...workItems.map((item) => item.evidence.duration.workItemDurationMs),
  );
  // The nested generic preflight is used exclusively for one current target
  // lane's readiness/worker/host facts. Its equal-duration plan is not reused
  // as this deadline estimate; `estimatedWorkDurationMs` above is exact for
  // the target's serial cell order.
  const capacity = preflightLocalCampaignCapacity({
    targets: [target],
    workItems: 1,
    workItemsByPlatform: { [target.platform]: 1 },
    duration: workItems.find(
      (item) => item.evidence.duration.workItemDurationMs === longestWorkItemDuration,
    )!.evidence.duration,
    deadlineMs: rawInput.deadlineMs,
    ...(setupHeadroomMs ? { setupHeadroomMs } : {}),
    ...(recoveryHeadroomMs ? { recoveryHeadroomMs } : {}),
    devices: rawInput.devices,
    leases: rawInput.leases,
    workers: rawInput.workers,
    at: checkedAt,
  });
  const scheduledInSingleTargetSnapshot = capacity.plan.slots.some(
    (slot) => slot.targetId === target.targetId && slot.platform === target.platform,
  );
  const scheduledInCampaignSnapshot =
    rawInput.scheduledTargetIds === undefined ||
    rawInput.scheduledTargetIds.map((targetId) => targetId.trim()).includes(target.targetId);
  const scheduled = scheduledInSingleTargetSnapshot && scheduledInCampaignSnapshot;
  const reservedHeadroomMs = checkedSum(
    setupHeadroomMs,
    recoveryHeadroomMs,
    "Campaign target critical-path headroom",
  );
  const workBudgetMs = Math.max(0, rawInput.deadlineMs - reservedHeadroomMs);
  const estimatedParallelDurationMs = checkedSum(
    estimatedWorkDurationMs,
    reservedHeadroomMs,
    "Campaign target critical-path duration",
  );
  const assurance = workItems.every(
    (item) => durationAssurance(item.evidence.duration, checkedAt) === "measured-current",
  )
    ? "measured-current"
    : "measurement-stale";
  const withinBudget = scheduled && estimatedWorkDurationMs <= workBudgetMs;
  const targetFact = capacity.targets[0];
  if (!targetFact) throw new Error("Campaign critical path target facts are unavailable");

  return {
    checkedAt,
    target: structuredClone(targetFact),
    criticalPath: {
      workItems: workItems.map((item) => structuredClone(item)),
      estimatedWorkDurationMs,
    },
    scheduled,
    deadline: {
      requestedMs: rawInput.deadlineMs,
      reservedHeadroomMs,
      workBudgetMs,
      estimatedParallelDurationMs,
      capacity: withinBudget ? "within-budget" : "outside-budget",
      assurance,
      achievableWithCurrentCapacity: withinBudget && assurance === "measured-current",
    },
    assumptions: [
      "Every work item is serial on this concrete target; the critical path sums its exact target/Test/action duration evidence.",
      "Each timing evidence record carries its estimator, source clock, bounded sample ids, and observation window.",
      "The target must survive both its direct readiness/worker snapshot and the campaign-wide target/host slot snapshot.",
      "This preflight did not acquire a lease, reserve a target, or enqueue work.",
      "Setup and recovery headroom are reserved once on this target's critical path.",
    ],
  };
}
