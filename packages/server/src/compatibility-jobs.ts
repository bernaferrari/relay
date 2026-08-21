import {
  buildTargetProfiles,
  enqueueJob,
  freezeRecipeExecution,
  listDevices,
  listDevicePools,
  listDeviceLeases,
  listTargets,
  now,
  readCompatibilityMatrix,
  releaseDeviceLease,
  requireOperationContext,
  resolveCompatibilityMatrix,
  runWithOperationContext,
} from "@relay/core";
import type { RequestContext } from "./security.js";
import { assertTargetControl } from "./access-control.js";
import { HttpError } from "./http.js";

export type CompatibilityBatchInput = {
  recipe?: string;
  matrixId?: string;
  repetitions?: number;
  prodAccountMatch?: string;
};

export type CompatibilityBatchRuntime = {
  listDevices: typeof listDevices;
  listTargets: typeof listTargets;
  listDevicePools: typeof listDevicePools;
  listDeviceLeases: typeof listDeviceLeases;
  assertTargetControl: typeof assertTargetControl;
  releaseDeviceLease: typeof releaseDeviceLease;
  enqueueJob: typeof enqueueJob;
};

const defaultRuntime: CompatibilityBatchRuntime = {
  listDevices,
  listTargets,
  listDevicePools,
  listDeviceLeases,
  assertTargetControl,
  releaseDeviceLease,
  enqueueJob,
};

async function freezeBatchExecution(body: CompatibilityBatchInput) {
  return freezeRecipeExecution(body.recipe!);
}

type TargetLease = Awaited<ReturnType<typeof assertTargetControl>>;

type TargetLeaseAdmission =
  | { status: "accepted"; targetId: string; lease: TargetLease }
  | { status: "rejected"; targetId: string; error: unknown };

/**
 * Admission is independent per target, so do not make an Android worker wait
 * for an unrelated iOS lease round-trip before it may be queued. The batch is
 * still atomic at the queue boundary: no job is created until every target is
 * admitted. If one admission fails, only leases first created by this attempt
 * are released; caller-owned leases that existed before admission are kept.
 */
async function acquireCompatibilityTargetLeases(input: {
  scope: RequestContext;
  targetIds: readonly string[];
  listDeviceLeases: typeof listDeviceLeases;
  assertTargetControl: typeof assertTargetControl;
  releaseDeviceLease: typeof releaseDeviceLease;
}): Promise<Map<string, TargetLease>> {
  const existingLeaseIds = new Set(
    (await input.listDeviceLeases(input.scope.projectId)).map((lease) => lease.id),
  );
  const operation = requireOperationContext();
  const targetIds = [...new Set(input.targetIds)];
  const admissions = await Promise.all(
    targetIds.map(async (targetId): Promise<TargetLeaseAdmission> => {
      try {
        // assertTargetControl records the lease in its async context. Give each
        // independent target its own copy so one result cannot overwrite the
        // lease provenance later frozen into another target's job.
        const lease = await runWithOperationContext({ ...operation }, () =>
          input.assertTargetControl(input.scope, targetId),
        );
        return { status: "accepted", targetId, lease };
      } catch (error) {
        return { status: "rejected", targetId, error };
      }
    }),
  );
  const rejected = admissions.find((admission) => admission.status === "rejected");
  if (rejected) {
    const newlyAcquired = admissions.filter(
      (admission): admission is Extract<TargetLeaseAdmission, { status: "accepted" }> =>
        admission.status === "accepted" && !existingLeaseIds.has(admission.lease.id),
    );
    const cleanup = await Promise.allSettled(
      newlyAcquired.map(({ lease }) =>
        input.releaseDeviceLease(lease.id, {
          projectId: input.scope.projectId,
          ownerId: lease.ownerId,
        }),
      ),
    );
    const cleanupFailure = cleanup.find((result) => result.status === "rejected");
    if (cleanupFailure?.status === "rejected") {
      const message =
        cleanupFailure.reason instanceof Error
          ? cleanupFailure.reason.message
          : String(cleanupFailure.reason);
      throw new Error(
        `Target admission failed and Relay could not release a newly acquired lease: ${message}`,
      );
    }
    throw rejected.error;
  }
  return new Map(
    admissions.map((admission) => {
      if (admission.status !== "accepted") {
        throw new Error("Compatibility target admission did not settle");
      }
      return [admission.targetId, admission.lease] as const;
    }),
  );
}

export async function enqueueCompatibilityBatch(
  scope: RequestContext,
  input: unknown,
  options: { kind: "compatibility" | "soak"; maxRepetitions: number; maxJobs: number },
  runtimeOverrides: Partial<CompatibilityBatchRuntime> = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "JSON object required");
  }
  const body = input as CompatibilityBatchInput;
  if (
    typeof body.recipe !== "string" ||
    !body.recipe.trim() ||
    typeof body.matrixId !== "string" ||
    !body.matrixId.trim()
  ) {
    throw new HttpError(400, "recipe and matrixId are required");
  }
  const runtime = { ...defaultRuntime, ...runtimeOverrides };
  const matrix = await readCompatibilityMatrix(scope.projectId, body.matrixId);
  if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
  const profiles = buildTargetProfiles({
    devices: await runtime.listDevices().catch(() => []),
    targets: await runtime.listTargets(),
  });
  const expansion = resolveCompatibilityMatrix(matrix, profiles);
  const frozenRecipe = await freezeBatchExecution(body);
  if (expansion.profiles.length === 0) {
    const details = expansion.excluded.map((item) => item.reason).join("; ");
    throw new HttpError(
      400,
      `Compatibility matrix “${matrix.name}” matched no targets${details ? ` (${details})` : ""}`,
    );
  }
  const pools = await runtime.listDevicePools(scope.projectId);
  const repetitions = Math.min(
    Math.max(Math.floor(body.repetitions ?? 1), 1),
    options.maxRepetitions,
  );
  const jobCount = repetitions * expansion.profiles.length;
  if (jobCount > options.maxJobs) {
    throw new HttpError(
      400,
      `Campaign expands to ${jobCount} jobs; reduce targets or repetitions below ${options.maxJobs}`,
    );
  }
  const operation = requireOperationContext();
  const leases = await acquireCompatibilityTargetLeases({
    scope,
    targetIds: expansion.profiles.map((profile) => profile.targetId),
    listDeviceLeases: runtime.listDeviceLeases,
    assertTargetControl: runtime.assertTargetControl,
    releaseDeviceLease: runtime.releaseDeviceLease,
  });
  const batchId = `${options.kind}-${matrix.id}-${now()}`;
  const jobs = expansion.profiles.flatMap((profile) =>
    Array.from({ length: repetitions }, (_, repetition) =>
      runWithOperationContext(
        {
          ...operation,
          leaseId: leases.get(profile.targetId)?.id,
          leaseOwnerId: leases.get(profile.targetId)?.ownerId,
        },
        () =>
          runtime.enqueueJob({
            recipe: frozenRecipe.recipeSnapshot.id,
            recipeSnapshot: frozenRecipe.recipeSnapshot,
            recipeGraph: frozenRecipe.recipeGraph,
            serial: profile.targetId,
            platform: profile.platform === "ios" ? "ios" : "android",
            targetKind: profile.source === "browser" ? "browser" : "device",
            ...(profile.source === "browser" ? { browserTargetId: profile.targetId } : {}),
            targetProfile: profile,
            prodAccountMatch: body.prodAccountMatch,
            batchId,
            caseIndex: repetition,
            caseCount: repetitions,
            artifacts: [
              {
                kind: "compatibility-profile",
                capturedAt: expansion.resolvedAt,
                data: { matrixId: matrix.id, matrixName: matrix.name, profile },
              },
              ...(options.kind === "soak"
                ? [
                    {
                      kind: "soak-campaign",
                      capturedAt: expansion.resolvedAt,
                      data: { repetitions, totalJobs: jobCount },
                    },
                  ]
                : []),
            ],
            projectId: scope.projectId,
            ownerId: operation.actorId,
            ...(leases.get(profile.targetId)
              ? {
                  workerId: `pool:${leases.get(profile.targetId)!.poolId}`,
                  workerCapacity: Math.max(
                    1,
                    new Set(
                      pools.find((pool) => pool.id === leases.get(profile.targetId)!.poolId)
                        ?.deviceSerials ?? [profile.targetId],
                    ).size,
                  ),
                }
              : {}),
          }),
      ),
    ),
  );
  return { matrix: expansion, jobs, batchId, repetitions };
}
