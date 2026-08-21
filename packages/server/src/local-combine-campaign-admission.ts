import {
  executionTargetRefKey,
  type CampaignCapacityDurationInput,
  type LocalAgentDeviceExecutionTargetRef,
  type LocalCampaignCapacityPreflight,
} from "@relay/protocol";
import {
  listDeviceLeases,
  listDevices,
  listTargetWorkers,
  localDeviceTargetForCombine,
  preflightLocalCampaignCapacity,
  releaseDeviceLease,
  requireOperationContext,
  type PreparedAppMapCombineCell,
} from "@relay/core";
import {
  admitTargetControl,
  assertTargetControl,
  targetLeaseBelongsToCaller,
} from "./access-control.js";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";
import {
  runWithLocalCapacityAdmissionLock,
  runWithTargetControlAdmissionLock,
} from "./target-control-admission-lock.js";
import { acquireTargetLeasesAtomically } from "./target-lease-admission.js";

export type LocalCombineCampaignAdmissionRequest = {
  deadlineMs: number;
  /** A conservative duration bound across every selected cell. Mixed-platform
   * requests must also supply the platform-specific observations below. */
  duration: CampaignCapacityDurationInput;
  durationsByPlatform?: Partial<Record<"android" | "ios", CampaignCapacityDurationInput>>;
  setupHeadroomMs?: number;
  recoveryHeadroomMs?: number;
};

export type LocalCombineCampaignAdmissionRuntime = {
  listDevices: typeof listDevices;
  listDeviceLeases: typeof listDeviceLeases;
  listTargetWorkers: typeof listTargetWorkers;
  assertTargetControl: typeof assertTargetControl;
  admitTargetControl: typeof admitTargetControl;
  releaseDeviceLease: typeof releaseDeviceLease;
};

export type LocalCombineCampaignAdmission = {
  preflight: LocalCampaignCapacityPreflight;
  /** Every cell is target-affine, so each physical lane has its own deadline
   * proof in addition to the aggregate Android/iOS slot report. */
  targetPreflights: LocalCampaignCapacityPreflight[];
  targets: LocalAgentDeviceExecutionTargetRef[];
  operationContextForCell: (
    cell: PreparedAppMapCombineCell,
  ) => ReturnType<typeof requireOperationContext>;
  /** Settle the lease claim only after staged campaign/job persistence commits. */
  commit(): Promise<void>;
  /** Seal the claim after jobs are visible but before their no-throw dispatch. */
  finalize(): Promise<void>;
  /** Release only lease capacity minted by this admission if that later write fails. */
  rollback(): Promise<void>;
};

function targetForCell(cell: PreparedAppMapCombineCell): LocalAgentDeviceExecutionTargetRef {
  const target = localDeviceTargetForCombine(cell.executionTarget);
  if (!target) {
    throw new HttpError(
      409,
      `Cell ${cell.cellId} does not name a local Android or iOS execution target.`,
      {
        code: "LOCAL_COMBINE_ADMISSION_TARGET_UNSUPPORTED",
        cellId: cell.cellId,
        target: cell.executionTarget,
        recovery:
          "Bind this cell to a local Android or iOS target. Relay will not pretend a browser or unconfigured provider session is local capacity.",
      },
    );
  }
  return target;
}

function uniqueTargets(
  cells: readonly PreparedAppMapCombineCell[],
): LocalAgentDeviceExecutionTargetRef[] {
  const byKey = new Map<string, LocalAgentDeviceExecutionTargetRef>();
  for (const cell of cells) {
    const target = targetForCell(cell);
    byKey.set(executionTargetRefKey(target), target);
  }
  return [...byKey.values()].sort((left, right) => {
    const leftKey = executionTargetRefKey(left);
    const rightKey = executionTargetRefKey(right);
    return leftKey.localeCompare(rightKey);
  });
}

function workItemsByPlatform(cells: readonly PreparedAppMapCombineCell[]) {
  return cells.reduce<{ android: number; ios: number }>(
    (counts, cell) => {
      const target = targetForCell(cell);
      counts[target.platform] += 1;
      return counts;
    },
    { android: 0, ios: 0 },
  );
}

function cellsByTarget(cells: readonly PreparedAppMapCombineCell[]) {
  const grouped = new Map<string, PreparedAppMapCombineCell[]>();
  for (const cell of cells) {
    const target = targetForCell(cell);
    const key = executionTargetRefKey(target);
    const targetCells = grouped.get(key) ?? [];
    targetCells.push(cell);
    grouped.set(key, targetCells);
  }
  return grouped;
}

/** A platform duration must describe that platform. A single Android timing
 * cannot be treated as an iOS budget simply because the campaign is mixed. */
function platformDurations(input: {
  targets: readonly LocalAgentDeviceExecutionTargetRef[];
  request: LocalCombineCampaignAdmissionRequest;
}): Map<"android" | "ios", CampaignCapacityDurationInput> {
  const platforms = [...new Set(input.targets.map((target) => target.platform))];
  const durations = new Map<"android" | "ios", CampaignCapacityDurationInput>();
  for (const platform of platforms) {
    const duration =
      input.request.durationsByPlatform?.[platform] ??
      (platforms.length === 1 ? input.request.duration : undefined);
    if (!duration) {
      throw new HttpError(
        400,
        `A current ${platform} duration is required for mixed-platform Combine admission.`,
        {
          code: "LOCAL_COMBINE_ADMISSION_PLATFORM_DURATION_REQUIRED",
          platform,
          recovery:
            "Provide durationsByPlatform for every bound Android and iOS target. Relay will not use one platform's timing as another platform's deadline evidence.",
        },
      );
    }
    durations.set(platform, duration);
  }
  const longestPlatformDuration = Math.max(
    ...[...durations.values()].map((duration) => duration.workItemDurationMs),
  );
  if (input.request.duration.workItemDurationMs < longestPlatformDuration) {
    throw new HttpError(
      400,
      "The aggregate Combine duration must be at least the slowest selected platform duration.",
      {
        code: "LOCAL_COMBINE_ADMISSION_DURATION_UNSAFE",
        aggregateDurationMs: input.request.duration.workItemDurationMs,
        longestPlatformDurationMs: longestPlatformDuration,
        recovery:
          "Use a conservative duration for the whole campaign and retain the measured duration for each platform in durationsByPlatform.",
      },
    );
  }
  return durations;
}

/**
 * Internal mutable boundary between a read-only capacity estimate and real
 * target control. Queue-bound callers must use `admitAndStage...` below so a
 * second request cannot inspect stale capacity before this admission stages.
 */
export type LocalCombineCampaignAdmissionInput = {
  scope: RequestContext;
  cells: readonly PreparedAppMapCombineCell[];
  request: LocalCombineCampaignAdmissionRequest;
  runtime: LocalCombineCampaignAdmissionRuntime;
  at?: number;
};

async function admitLocalCombineCampaignUnlocked(
  input: LocalCombineCampaignAdmissionInput,
): Promise<LocalCombineCampaignAdmission> {
  if (!input.cells.length) throw new Error("Local Combine admission requires at least one cell");
  const targets = uniqueTargets(input.cells);
  const counts = workItemsByPlatform(input.cells);
  const cellsForTarget = cellsByTarget(input.cells);
  const durations = platformDurations({ targets, request: input.request });
  const operation = requireOperationContext();
  const checkedAt = input.at ?? Date.now();
  let devices;
  let leases;
  try {
    [devices, leases] = await Promise.all([
      input.runtime.listDevices(),
      input.runtime.listDeviceLeases(input.scope.projectId),
    ]);
  } catch (error) {
    throw new HttpError(503, "Relay cannot read current local campaign capacity", {
      code: "LOCAL_COMBINE_ADMISSION_FACTS_UNAVAILABLE",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const requestedTargetIds = new Set(targets.map((target) => target.targetId));
  // A valid lease already controlled by this operation's actor is usable
  // capacity, not foreign occupancy. Scheduler active/queued facts still
  // exclude the target, so this only prevents a pilot from blocking its own
  // safe resume until the two-hour local-control lease expires.
  const capacityLeases = leases.filter(
    (lease) =>
      !requestedTargetIds.has(lease.deviceSerial) ||
      !targetLeaseBelongsToCaller(input.scope, lease, operation.actorId),
  );
  const workers = input.runtime.listTargetWorkers();
  const preflight = preflightLocalCampaignCapacity({
    targets: targets.map((target) => ({ targetId: target.targetId, platform: target.platform })),
    workItems: input.cells.length,
    workItemsByPlatform: counts,
    duration: input.request.duration,
    deadlineMs: input.request.deadlineMs,
    ...(input.request.setupHeadroomMs === undefined
      ? {}
      : { setupHeadroomMs: input.request.setupHeadroomMs }),
    ...(input.request.recoveryHeadroomMs === undefined
      ? {}
      : { recoveryHeadroomMs: input.request.recoveryHeadroomMs }),
    devices,
    leases: capacityLeases,
    workers,
    at: checkedAt,
  });
  const targetPreflights = targets.map((target) => {
    const targetCells = cellsForTarget.get(executionTargetRefKey(target));
    if (!targetCells?.length) {
      throw new Error(`Bound target ${target.targetId} has no Combine cells`);
    }
    const workItemsByTargetPlatform: Partial<Record<"android" | "ios", number>> = {
      [target.platform]: targetCells.length,
    };
    return preflightLocalCampaignCapacity({
      targets: [{ targetId: target.targetId, platform: target.platform }],
      workItems: targetCells.length,
      workItemsByPlatform: workItemsByTargetPlatform,
      duration: durations.get(target.platform)!,
      deadlineMs: input.request.deadlineMs,
      ...(input.request.setupHeadroomMs === undefined
        ? {}
        : { setupHeadroomMs: input.request.setupHeadroomMs }),
      ...(input.request.recoveryHeadroomMs === undefined
        ? {}
        : { recoveryHeadroomMs: input.request.recoveryHeadroomMs }),
      devices,
      leases: capacityLeases,
      workers,
      at: checkedAt,
    });
  });
  const blockedTargetIndex = targetPreflights.findIndex(
    (targetPreflight) => !targetPreflight.deadline.achievableWithCurrentCapacity,
  );
  if (!preflight.deadline.achievableWithCurrentCapacity || blockedTargetIndex >= 0) {
    const blockedTarget = blockedTargetIndex >= 0 ? targets[blockedTargetIndex] : undefined;
    throw new HttpError(
      409,
      blockedTarget
        ? `Local Combine deadline is infeasible for target ${blockedTarget.targetId}.`
        : "Local Combine deadline is infeasible with the currently observed targets.",
      {
        code: "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE",
        preflight,
        targetPreflights,
        ...(blockedTarget
          ? {
              target: blockedTarget,
              assignedWorkItems: cellsForTarget.get(executionTargetRefKey(blockedTarget))?.length,
            }
          : {}),
        recovery:
          "Add fresh, available local target capacity, rebalance explicitly bound cells, reduce the selected cells, or request a deadline that the current measured p50/p95 can satisfy.",
      },
    );
  }
  const leaseAdmission = await acquireTargetLeasesAtomically({
    scope: input.scope,
    targetIds: targets.map((target) => target.targetId),
    listDeviceLeases: input.runtime.listDeviceLeases,
    admitTargetControl: input.runtime.admitTargetControl,
    releaseDeviceLease: input.runtime.releaseDeviceLease,
  });
  const leasesByTargetId = leaseAdmission.leasesByTargetId;
  return {
    preflight,
    targetPreflights,
    targets: targets.map((target) => structuredClone(target)),
    operationContextForCell(cell) {
      const target = targetForCell(cell);
      const lease = leasesByTargetId.get(target.targetId);
      if (!lease) {
        throw new Error(`Accepted target ${target.targetId} has no admitted lease`);
      }
      return { ...operation, leaseId: lease.id, leaseOwnerId: lease.ownerId };
    },
    commit: leaseAdmission.commit,
    finalize: leaseAdmission.finalize,
    rollback: leaseAdmission.rollback,
  };
}

/**
 * Keep the capacity snapshot, exact lease admission, and scheduler staging in
 * one process-wide local-capacity transaction, nested around the project
 * lease-provenance transaction. A staged batch is then visible through
 * scheduler status before another project can preflight, so two callers
 * cannot both promise the same target- or host-affine deadline.
 */
export async function admitAndStageLocalCombineCampaign<T>(
  input: LocalCombineCampaignAdmissionInput & {
    stage: (admission: LocalCombineCampaignAdmission) => T | Promise<T>;
  },
): Promise<{ admission: LocalCombineCampaignAdmission; staged: T }> {
  return runWithLocalCapacityAdmissionLock(() =>
    runWithTargetControlAdmissionLock(input.scope, async () => {
      const admission = await admitLocalCombineCampaignUnlocked(input);
      try {
        return { admission, staged: await input.stage(admission) };
      } catch (error) {
        try {
          await admission.rollback();
        } catch (cleanupError) {
          const detail =
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          throw new Error(
            `Local Combine staging failed (${error instanceof Error ? error.message : String(error)}) and lease compensation also failed: ${detail}`,
          );
        }
        throw error;
      }
    }),
  );
}
