import type {
  CampaignCapacityDurationInput,
  CampaignCapacityMeasurementAssurance,
  CampaignCapacityTarget,
  CampaignCapacityWorker,
  DeviceLease,
  LocalCampaignCapacityPreflight,
  LocalCampaignCapacityPreflightInput,
  LocalCampaignCapacityTargetFact,
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
  const duration = input.duration;
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
      "Queued work is reported by the plan but its drain time is not included in the deadline estimate.",
      "Setup and recovery headroom are reserved once on the campaign critical path, not multiplied by every work item.",
      "A supplied or stale duration can size work, but cannot make the deadline achievable with current capacity.",
    ],
  };
}
