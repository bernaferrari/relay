import {
  buildTargetProfiles,
  freezeRecipeExecution,
  listDevices,
  listDevicePools,
  listDeviceLeases,
  listTargets,
  now,
  prepareJobBatch,
  readCompatibilityMatrix,
  releaseDeviceLease,
  requireOperationContext,
  resolveCompatibilityMatrix,
} from "@relay/core";
import type { RequestContext } from "./security.js";
import { admitTargetControl } from "./access-control.js";
import { HttpError } from "./http.js";
import { acquireTargetLeasesAtomically } from "./target-lease-admission.js";

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
  admitTargetControl: typeof admitTargetControl;
  releaseDeviceLease: typeof releaseDeviceLease;
  prepareJobBatch: typeof prepareJobBatch;
};

const defaultRuntime: CompatibilityBatchRuntime = {
  listDevices,
  listTargets,
  listDevicePools,
  listDeviceLeases,
  admitTargetControl,
  releaseDeviceLease,
  prepareJobBatch,
};

async function freezeBatchExecution(body: CompatibilityBatchInput) {
  return freezeRecipeExecution(body.recipe!);
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
  const leaseAdmission = await acquireTargetLeasesAtomically({
    scope,
    targetIds: expansion.profiles.map((profile) => profile.targetId),
    listDeviceLeases: runtime.listDeviceLeases,
    admitTargetControl: runtime.admitTargetControl,
    releaseDeviceLease: runtime.releaseDeviceLease,
  });
  const leases = leaseAdmission.leasesByTargetId;
  const batchId = `${options.kind}-${matrix.id}-${now()}`;
  const inputs: Parameters<typeof prepareJobBatch>[0] = expansion.profiles.flatMap(
    (profile, profileIndex) =>
      Array.from({ length: repetitions }, (_, repetition) => {
        const lease = leases.get(profile.targetId);
        return {
          input: {
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
            caseIndex: profileIndex * repetitions + repetition,
            caseCount: jobCount,
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
            ...(lease
              ? {
                  workerId: `pool:${lease.poolId}`,
                  workerCapacity: Math.max(
                    1,
                    new Set(
                      pools.find((pool) => pool.id === lease.poolId)?.deviceSerials ?? [
                        profile.targetId,
                      ],
                    ).size,
                  ),
                }
              : {}),
          },
          operationContext: {
            ...operation,
            ...(lease ? { leaseId: lease.id, leaseOwnerId: lease.ownerId } : {}),
          },
        };
      }),
  );
  let staged: ReturnType<typeof prepareJobBatch> | undefined;
  try {
    staged = runtime.prepareJobBatch(inputs);
    staged.activate();
    await leaseAdmission.commit();
    await leaseAdmission.finalize();
    const jobs = staged.dispatch();
    staged = undefined;
    return { matrix: expansion, jobs, batchId, repetitions };
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    try {
      staged?.rollback();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    try {
      await leaseAdmission.rollback();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    if (cleanupFailures.length) {
      const details = cleanupFailures
        .map((cleanupError) =>
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        )
        .join("; ");
      throw new Error(
        `Compatibility batch admission failed (${error instanceof Error ? error.message : String(error)}) and compensation also failed: ${details}`,
      );
    }
    throw error;
  }
}
