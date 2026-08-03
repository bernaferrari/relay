import {
  buildTargetProfiles,
  currentOperationContext,
  enqueueJob,
  freezeRecipeExecution,
  listDevices,
  listDevicePools,
  listTargets,
  now,
  readCompatibilityMatrix,
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
  assertTargetControl: typeof assertTargetControl;
  enqueueJob: typeof enqueueJob;
};

const defaultRuntime: CompatibilityBatchRuntime = {
  listDevices,
  listTargets,
  listDevicePools,
  assertTargetControl,
  enqueueJob,
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
  const leases = new Map<string, Awaited<ReturnType<typeof assertTargetControl>>>();
  for (const profile of expansion.profiles) {
    leases.set(profile.targetId, await runtime.assertTargetControl(scope, profile.targetId));
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
  const batchId = `${options.kind}-${matrix.id}-${now()}`;
  const jobs = expansion.profiles.flatMap((profile) =>
    Array.from({ length: repetitions }, (_, repetition) =>
      runWithOperationContext(
        { ...requireOperationContext(), leaseId: leases.get(profile.targetId)?.id },
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
            ownerId: currentOperationContext()!.actorId,
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
