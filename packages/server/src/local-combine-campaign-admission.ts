import {
  assertExecutionTargetRef,
  executionTargetRefKey,
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type CampaignCapacityCohortDurationEvidence,
  type CampaignCapacityDurationCohort,
  type LocalAgentDeviceExecutionTargetRef,
  type LocalCampaignAdmissionRequest,
  type LocalCampaignAdmissionWorkItem,
  type LocalCampaignCapacityPreflight,
  type LocalCampaignCapacityTargetCriticalPathPreflight,
} from "@relay/protocol";
import {
  MIN_CAMPAIGN_DURATION_MIN_SAMPLES,
  listDeviceLeases,
  listDevices,
  listTargetWorkers,
  localDeviceTargetForCombine,
  preflightLocalCampaignCapacity,
  preflightLocalCampaignTargetCriticalPath,
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
import { verifyCampaignDurationCohortEvidence } from "./campaign-duration-cohort-evidence.js";
import type { RequestContext } from "./security.js";
import {
  runWithLocalCapacityAdmissionLock,
  runWithTargetControlAdmissionLock,
} from "./target-control-admission-lock.js";
import { acquireTargetLeasesAtomically } from "./target-lease-admission.js";

export type { LocalCampaignAdmissionRequest } from "@relay/protocol";

/** Kept as the public Combine name while generic callers use the base shape. */
export type LocalCombineCampaignAdmissionRequest = LocalCampaignAdmissionRequest;

export type LocalCombineCampaignAdmissionRuntime = {
  listDevices: typeof listDevices;
  listDeviceLeases: typeof listDeviceLeases;
  listTargetWorkers: typeof listTargetWorkers;
  assertTargetControl: typeof assertTargetControl;
  admitTargetControl: typeof admitTargetControl;
  releaseDeviceLease: typeof releaseDeviceLease;
  /** Production re-derives submitted evidence from project-scoped persisted
   * runs. Tests may inject a deterministic verifier without weakening that
   * default server boundary. */
  verifyCampaignDurationCohortEvidence?: typeof verifyCampaignDurationCohortEvidence;
};

export type { LocalCampaignAdmissionWorkItem } from "@relay/protocol";

export type LocalCampaignAdmission = {
  preflight: LocalCampaignCapacityPreflight;
  /** Every cell is target-affine, so each physical lane has its own deadline
   * proof with its complete target/Test/action evidence. */
  targetPreflights: LocalCampaignCapacityTargetCriticalPathPreflight[];
  targets: LocalAgentDeviceExecutionTargetRef[];
  operationContextForWorkItem: (
    workItem: LocalCampaignAdmissionWorkItem,
  ) => ReturnType<typeof requireOperationContext>;
  /** Settle the lease claim only after staged campaign/job persistence commits. */
  commit(): Promise<void>;
  /** Seal the claim after jobs are visible but before their no-throw dispatch. */
  finalize(): Promise<void>;
  /** Release only lease capacity minted by this admission if that later write fails. */
  rollback(): Promise<void>;
};

export type LocalCombineCampaignAdmission = LocalCampaignAdmission & {
  operationContextForCell: (
    cell: PreparedAppMapCombineCell,
  ) => ReturnType<typeof requireOperationContext>;
};

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${label} is required`, {
      code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
    });
  }
  return value.trim();
}

function cohortKey(cohort: CampaignCapacityDurationCohort): string {
  return JSON.stringify([cohort.targetId, cohort.platform, cohort.testId, cohort.action]);
}

function cohortForWorkItem(
  workItem: LocalCampaignAdmissionWorkItem,
): CampaignCapacityDurationCohort {
  return {
    targetId: workItem.target.targetId,
    platform: workItem.target.platform,
    testId: workItem.testId,
    action: workItem.action,
  };
}

type NormalizedSubmittedCohortEvidence = {
  evidence: CampaignCapacityCohortDurationEvidence;
  cohort: CampaignCapacityDurationCohort;
  key: string;
};

function requireDurationEvidence(request: LocalCampaignAdmissionRequest): readonly unknown[] {
  if (!Array.isArray(request.durationEvidence)) {
    throw new HttpError(400, "Local campaign admission requires durationEvidence", {
      code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_REQUIRED",
      recovery:
        "Obtain current target/Test cohort estimates and attach one evidence record for every selected work item cohort.",
    });
  }
  return request.durationEvidence;
}

function normalizeSubmittedCohortEvidence(rawEvidence: unknown): NormalizedSubmittedCohortEvidence {
  if (!rawEvidence || typeof rawEvidence !== "object") {
    throw new HttpError(400, "Local campaign duration evidence is malformed", {
      code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
    });
  }
  const evidence = structuredClone(rawEvidence) as Partial<CampaignCapacityCohortDurationEvidence>;
  const cohort = evidence.cohort;
  if (
    evidence.schemaVersion !== 1 ||
    !cohort ||
    (cohort.platform !== "android" && cohort.platform !== "ios")
  ) {
    throw new HttpError(400, "Local campaign duration evidence is malformed", {
      code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
    });
  }
  const normalized: CampaignCapacityDurationCohort = {
    targetId: requiredString(cohort.targetId, "Campaign duration evidence targetId"),
    platform: cohort.platform,
    testId: requiredString(cohort.testId, "Campaign duration evidence testId"),
    action: requiredString(cohort.action, "Campaign duration evidence action"),
  };
  return {
    evidence: {
      ...evidence,
      cohort: normalized,
      duration: structuredClone(evidence.duration),
      measurement: structuredClone(evidence.measurement),
    } as CampaignCapacityCohortDurationEvidence,
    cohort: normalized,
    key: cohortKey(normalized),
  };
}

function cohortMapForWorkItems(
  workItems: readonly LocalCampaignAdmissionWorkItem[],
): Map<string, CampaignCapacityDurationCohort> {
  const cohorts = new Map<string, CampaignCapacityDurationCohort>();
  for (const workItem of workItems) {
    const cohort = cohortForWorkItem(workItem);
    cohorts.set(cohortKey(cohort), cohort);
  }
  return cohorts;
}

function requireCompleteKnownCohortEvidence(input: {
  request: LocalCampaignAdmissionRequest;
  knownCohorts: ReadonlyMap<string, CampaignCapacityDurationCohort>;
}): Map<string, CampaignCapacityCohortDurationEvidence> {
  const evidenceByCohort = new Map<string, CampaignCapacityCohortDurationEvidence>();
  for (const rawEvidence of requireDurationEvidence(input.request)) {
    const { evidence, cohort, key } = normalizeSubmittedCohortEvidence(rawEvidence);
    if (!input.knownCohorts.has(key)) {
      throw new HttpError(
        409,
        "Local campaign duration evidence does not match any selected target/Test/action cohort.",
        {
          code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INCOMPATIBLE",
          cohort,
          recovery:
            "Refresh estimates for the current target bindings and selected Tests. Relay will not substitute platform-wide timing evidence.",
        },
      );
    }
    if (evidenceByCohort.has(key)) {
      throw new HttpError(400, "Local campaign has duplicate duration evidence for one cohort", {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
        cohort,
      });
    }
    evidenceByCohort.set(key, evidence);
  }
  const missing = [...input.knownCohorts.entries()]
    .filter(([key]) => !evidenceByCohort.has(key))
    .map(([, cohort]) => cohort);
  if (missing.length) {
    throw new HttpError(
      409,
      "Local campaign is missing duration evidence for one or more target/Test/action cohorts.",
      {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_REQUIRED",
        missing,
        recovery:
          "Obtain fresh timing evidence for every concrete target and selected Test/action. Platform averages cannot fill this gap.",
      },
    );
  }
  return evidenceByCohort;
}

/**
 * A pilot persists proof for its complete selected campaign but only reserves
 * the cells it stages now. This boundary narrows the durable proof for the
 * active stage while retaining a complete, known-only proof for later resume.
 * Each staged subset still undergoes fresh timing and provenance verification.
 */
export function localCampaignAdmissionRequestForActiveWorkItems(input: {
  request: LocalCampaignAdmissionRequest;
  activeWorkItems: readonly LocalCampaignAdmissionWorkItem[];
  knownWorkItems?: readonly LocalCampaignAdmissionWorkItem[];
}): LocalCampaignAdmissionRequest {
  const activeCohorts = cohortMapForWorkItems(normalizeWorkItems(input.activeWorkItems));
  const knownCohorts = cohortMapForWorkItems(
    normalizeWorkItems(input.knownWorkItems ?? input.activeWorkItems),
  );
  for (const [key, cohort] of activeCohorts) {
    if (!knownCohorts.has(key)) {
      throw new HttpError(400, "Active local campaign work is outside its known campaign scope", {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
        cohort,
      });
    }
  }
  const knownEvidence = requireCompleteKnownCohortEvidence({
    request: input.request,
    knownCohorts,
  });
  return {
    ...structuredClone(input.request),
    durationEvidence: [...activeCohorts.keys()].map((key) => knownEvidence.get(key)!),
  };
}

/** Stable across wrapper recompiles and variable values, while still scoped to
 * the saved App Map Test. The frozen job artifact records this exact action so
 * later duration estimation never has to treat a generated wrapper id as a
 * user-facing cohort identity. */
export function localCampaignAdmissionAction(input: { appMapId: string; testId: string }): string {
  const appMapId = requiredString(input.appMapId, "Local campaign App Map id");
  const testId = requiredString(input.testId, "Local campaign Test id");
  return `app-map:${appMapId}:test:${testId}`;
}

function normalizeWorkItems(
  rawWorkItems: readonly LocalCampaignAdmissionWorkItem[],
): LocalCampaignAdmissionWorkItem[] {
  if (!rawWorkItems.length)
    throw new Error("Local campaign admission requires at least one work item");
  const seen = new Set<string>();
  return rawWorkItems.map((raw) => {
    const id = requiredString(raw.id, "Local campaign work item id");
    if (seen.has(id)) {
      throw new HttpError(400, `Local campaign work item ${id} is duplicated`, {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
      });
    }
    seen.add(id);
    try {
      assertExecutionTargetRef(raw.target);
    } catch {
      throw new HttpError(409, `Work item ${id} does not name a coherent local target.`, {
        code: "LOCAL_COMBINE_ADMISSION_TARGET_UNSUPPORTED",
        workItemId: id,
        target: raw.target,
        recovery:
          "Bind this work item to a canonical local Android or iOS target. Relay will not treat a provider-shaped or malformed target as local capacity.",
      });
    }
    const target = localDeviceTargetForCombine(raw.target);
    if (!target) {
      throw new HttpError(409, `Work item ${id} does not name a local Android or iOS target.`, {
        code: "LOCAL_COMBINE_ADMISSION_TARGET_UNSUPPORTED",
        workItemId: id,
        target: raw.target,
        recovery:
          "Bind this work item to a coherent local Android or iOS target. Relay will not treat a browser or unconfigured provider session as local capacity.",
      });
    }
    return {
      id,
      target,
      testId: requiredString(raw.testId, "Local campaign work item testId"),
      action: requiredString(raw.action, "Local campaign work item action"),
    };
  });
}

function uniqueTargets(
  workItems: readonly LocalCampaignAdmissionWorkItem[],
): LocalAgentDeviceExecutionTargetRef[] {
  const byKey = new Map<string, LocalAgentDeviceExecutionTargetRef>();
  for (const workItem of workItems)
    byKey.set(executionTargetRefKey(workItem.target), workItem.target);
  return [...byKey.values()].sort((left, right) =>
    executionTargetRefKey(left).localeCompare(executionTargetRefKey(right)),
  );
}

function workItemsByPlatform(workItems: readonly LocalCampaignAdmissionWorkItem[]) {
  return workItems.reduce<{ android: number; ios: number }>(
    (counts, workItem) => {
      counts[workItem.target.platform] += 1;
      return counts;
    },
    { android: 0, ios: 0 },
  );
}

function workItemsByTarget(workItems: readonly LocalCampaignAdmissionWorkItem[]) {
  const grouped = new Map<string, LocalCampaignAdmissionWorkItem[]>();
  for (const workItem of workItems) {
    const key = executionTargetRefKey(workItem.target);
    const targetWorkItems = grouped.get(key) ?? [];
    targetWorkItems.push(workItem);
    grouped.set(key, targetWorkItems);
  }
  return grouped;
}

function currentCohortEvidence(input: {
  request: LocalCampaignAdmissionRequest;
  workItems: readonly LocalCampaignAdmissionWorkItem[];
  at: number;
}): Map<string, CampaignCapacityCohortDurationEvidence> {
  const expected = cohortMapForWorkItems(input.workItems);
  const evidenceByCohort = new Map<string, CampaignCapacityCohortDurationEvidence>();
  for (const rawEvidence of requireDurationEvidence(input.request)) {
    const { evidence, cohort, key } = normalizeSubmittedCohortEvidence(rawEvidence);
    if (!expected.has(key)) {
      throw new HttpError(
        409,
        "Local campaign duration evidence does not match any selected target/Test/action cohort.",
        {
          code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INCOMPATIBLE",
          cohort,
          recovery:
            "Refresh estimates for the current target bindings and selected Tests. Relay will not substitute platform-wide timing evidence.",
        },
      );
    }
    if (evidenceByCohort.has(key)) {
      throw new HttpError(400, "Local campaign has duplicate duration evidence for one cohort", {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
        cohort,
      });
    }
    const duration = evidence.duration;
    if (
      !duration ||
      (duration.provenance !== "observed-p50" && duration.provenance !== "observed-p95") ||
      !Number.isSafeInteger(duration.workItemDurationMs) ||
      duration.workItemDurationMs <= 0 ||
      !Number.isSafeInteger(duration.observedAt) ||
      duration.observedAt < 0 ||
      !Number.isSafeInteger(duration.sampleCount) ||
      duration.sampleCount < MIN_CAMPAIGN_DURATION_MIN_SAMPLES ||
      !Number.isSafeInteger(duration.maxAgeMs) ||
      duration.maxAgeMs < 0 ||
      duration.maxAgeMs > MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS
    ) {
      throw new HttpError(400, "Local campaign duration evidence is not a sufficient observation", {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INVALID",
        cohort,
        recovery: `Use an observed p50 or p95 based on at least ${MIN_CAMPAIGN_DURATION_MIN_SAMPLES} successful terminal samples and an evidence age no greater than ${MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS}ms.`,
      });
    }
    if (duration.observedAt > input.at || input.at - duration.observedAt > duration.maxAgeMs) {
      throw new HttpError(409, "Local campaign duration evidence is stale for deadline admission", {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_STALE",
        cohort,
        observedAt: duration.observedAt,
        checkedAt: input.at,
        maxAgeMs: duration.maxAgeMs,
        recovery:
          "Refresh this concrete target/Test/action cohort. Relay will not use a stale platform or device estimate to promise a deadline.",
      });
    }
    evidenceByCohort.set(key, evidence);
  }
  const missing = [...expected.entries()]
    .filter(([key]) => !evidenceByCohort.has(key))
    .map(([, cohort]) => cohort);
  if (missing.length) {
    throw new HttpError(
      409,
      "Local campaign is missing duration evidence for one or more target/Test/action cohorts.",
      {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_REQUIRED",
        missing,
        recovery:
          "Obtain fresh timing evidence for every concrete target and selected Test/action. Platform averages cannot fill this gap.",
      },
    );
  }
  return evidenceByCohort;
}

export function localCampaignAdmissionWorkItemsForCombine(
  cells: readonly PreparedAppMapCombineCell[],
): LocalCampaignAdmissionWorkItem[] {
  return normalizeWorkItems(
    cells.map((cell) => {
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
      return {
        id: cell.cellId,
        target,
        testId: cell.testId,
        action: localCampaignAdmissionAction({
          appMapId: cell.childIntent.sourcePlan.appMapId,
          testId: cell.testId,
        }),
      };
    }),
  );
}

/**
 * Internal mutable boundary between a read-only capacity estimate and real
 * target control. Queue-bound callers must use `admitAndStage...` below so a
 * second request cannot inspect stale capacity before this admission stages.
 */
export type LocalCampaignAdmissionInput = {
  scope: RequestContext;
  workItems: readonly LocalCampaignAdmissionWorkItem[];
  request: LocalCampaignAdmissionRequest;
  runtime: LocalCombineCampaignAdmissionRuntime;
  at?: number;
};

export type LocalCombineCampaignAdmissionInput = Omit<LocalCampaignAdmissionInput, "workItems"> & {
  cells: readonly PreparedAppMapCombineCell[];
};

export type LocalCampaignAdmissionPreflight = {
  preflight: LocalCampaignCapacityPreflight;
  targetPreflights: LocalCampaignCapacityTargetCriticalPathPreflight[];
};

export type LocalCampaignAdmissionPreflightInput = LocalCampaignAdmissionInput & {
  /** A read-only request has no staged operation context; it can still regard
   * this actor's existing lease as usable capacity while inspecting facts. */
  actorId?: string;
};

type ResolvedLocalCampaignAdmissionPreflight = LocalCampaignAdmissionPreflight & {
  workItems: LocalCampaignAdmissionWorkItem[];
  targets: LocalAgentDeviceExecutionTargetRef[];
  itemsForTarget: Map<string, LocalCampaignAdmissionWorkItem[]>;
};

async function resolveLocalCampaignAdmissionPreflight(
  input: LocalCampaignAdmissionPreflightInput,
): Promise<ResolvedLocalCampaignAdmissionPreflight> {
  const workItems = normalizeWorkItems(input.workItems);
  const targets = uniqueTargets(workItems);
  const counts = workItemsByPlatform(workItems);
  const itemsForTarget = workItemsByTarget(workItems);
  const checkedAt = input.at ?? Date.now();
  const submittedEvidenceByCohort = currentCohortEvidence({
    request: input.request,
    workItems,
    at: checkedAt,
  });
  const evidenceByCohort = await (
    input.runtime.verifyCampaignDurationCohortEvidence ?? verifyCampaignDurationCohortEvidence
  )({
    scope: input.scope,
    evidence: [...submittedEvidenceByCohort.values()],
    at: checkedAt,
  });
  for (const [key, evidence] of submittedEvidenceByCohort) {
    if (!evidenceByCohort.has(key)) {
      throw new HttpError(
        409,
        "Local campaign duration verifier did not return every submitted cohort.",
        {
          code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_UNVERIFIED",
          cohort: evidence.cohort,
          recovery:
            "Refresh the target/Test/action estimates. Relay will not substitute an omitted verifier result.",
        },
      );
    }
  }
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
      !targetLeaseBelongsToCaller(input.scope, lease, input.actorId ?? input.scope.subject),
  );
  const workers = input.runtime.listTargetWorkers();
  const representativeDuration = [...evidenceByCohort.values()].sort(
    (left, right) =>
      right.duration.workItemDurationMs - left.duration.workItemDurationMs ||
      cohortKey(left.cohort).localeCompare(cohortKey(right.cohort)),
  )[0]!.duration;
  const preflight = preflightLocalCampaignCapacity({
    targets: targets.map((target) => ({ targetId: target.targetId, platform: target.platform })),
    workItems: workItems.length,
    workItemsByPlatform: counts,
    // This aggregate plan only reports campaign-wide target/host slot facts.
    // Admission itself uses the exact target critical paths below, never this
    // maximum cohort as a platform-wide deadline substitute.
    duration: representativeDuration,
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
  const scheduledTargetIds = preflight.plan.slots.map((slot) => slot.targetId);
  const targetPreflights = targets.map((target) => {
    const targetWorkItems = itemsForTarget.get(executionTargetRefKey(target));
    if (!targetWorkItems?.length) {
      throw new Error(`Bound target ${target.targetId} has no campaign work items`);
    }
    return preflightLocalCampaignTargetCriticalPath({
      target: { targetId: target.targetId, platform: target.platform },
      workItems: targetWorkItems.map((workItem) => ({
        workItemId: workItem.id,
        evidence: evidenceByCohort.get(cohortKey(cohortForWorkItem(workItem)))!,
      })),
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
      scheduledTargetIds,
    });
  });
  return { workItems, targets, itemsForTarget, preflight, targetPreflights };
}

/**
 * Read an exact target-affine admission proof without leasing, reserving, or
 * staging anything. This is the UI/CLI check path; queueing must still use
 * `admitAndStageLocalCampaign` so its fact read and lease acquisition remain
 * one transaction.
 */
export async function preflightLocalCampaignAdmission(
  input: LocalCampaignAdmissionPreflightInput,
): Promise<LocalCampaignAdmissionPreflight> {
  return runWithLocalCapacityAdmissionLock(async () => {
    const resolved = await resolveLocalCampaignAdmissionPreflight(input);
    return {
      preflight: structuredClone(resolved.preflight),
      targetPreflights: structuredClone(resolved.targetPreflights),
    };
  });
}

async function admitLocalCampaignUnlocked(
  input: LocalCampaignAdmissionInput,
): Promise<LocalCampaignAdmission> {
  const operation = requireOperationContext();
  const { workItems, targets, itemsForTarget, preflight, targetPreflights } =
    await resolveLocalCampaignAdmissionPreflight({ ...input, actorId: operation.actorId });
  const blockedTargetIndex = targetPreflights.findIndex(
    (targetPreflight) => !targetPreflight.deadline.achievableWithCurrentCapacity,
  );
  if (blockedTargetIndex >= 0) {
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
              assignedWorkItems: itemsForTarget.get(executionTargetRefKey(blockedTarget))?.length,
            }
          : {}),
        recovery:
          "Refresh the exact target/Test timing cohort, add local capacity, rebalance explicitly bound work, reduce the selected cells, or request a deadline that those measured critical paths can satisfy.",
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
    operationContextForWorkItem(workItem) {
      const normalized = workItems.find((item) => item.id === workItem.id);
      if (!normalized) {
        throw new Error(
          `Work item ${workItem.id} was not accepted by this local campaign admission`,
        );
      }
      const lease = leasesByTargetId.get(normalized.target.targetId);
      if (!lease) {
        throw new Error(`Accepted target ${normalized.target.targetId} has no admitted lease`);
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
export async function admitAndStageLocalCampaign<T>(
  input: LocalCampaignAdmissionInput & {
    stage: (admission: LocalCampaignAdmission) => T | Promise<T>;
  },
): Promise<{ admission: LocalCampaignAdmission; staged: T }> {
  return runWithLocalCapacityAdmissionLock(() =>
    runWithTargetControlAdmissionLock(input.scope, async () => {
      const admission = await admitLocalCampaignUnlocked(input);
      try {
        return { admission, staged: await input.stage(admission) };
      } catch (error) {
        try {
          await admission.rollback();
        } catch (cleanupError) {
          const detail =
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          throw new Error(
            `Local campaign staging failed (${error instanceof Error ? error.message : String(error)}) and lease compensation also failed: ${detail}`,
          );
        }
        throw error;
      }
    }),
  );
}

/** Adapter for App Map Combine. The scheduling contract above remains usable
 * for locale matrices and future non-Combine local campaigns without making
 * their cases pretend to be PreparedAppMapCombineCell instances. */
export async function admitAndStageLocalCombineCampaign<T>(
  input: LocalCombineCampaignAdmissionInput & {
    stage: (admission: LocalCombineCampaignAdmission) => T | Promise<T>;
  },
): Promise<{ admission: LocalCombineCampaignAdmission; staged: T }> {
  const workItems = localCampaignAdmissionWorkItemsForCombine(input.cells);
  let combineAdmission: LocalCombineCampaignAdmission | undefined;
  const result = await admitAndStageLocalCampaign({
    scope: input.scope,
    workItems,
    request: input.request,
    runtime: input.runtime,
    ...(input.at === undefined ? {} : { at: input.at }),
    stage(admission) {
      combineAdmission = {
        ...admission,
        operationContextForCell(cell) {
          const workItem = workItems.find((item) => item.id === cell.cellId);
          if (!workItem) {
            throw new Error(`Combine cell ${cell.cellId} was not accepted by this local admission`);
          }
          return admission.operationContextForWorkItem(workItem);
        },
      };
      return input.stage(combineAdmission);
    },
  });
  if (!combineAdmission) throw new Error("Local Combine admission did not stage work");
  return { admission: combineAdmission, staged: result.staged };
}
