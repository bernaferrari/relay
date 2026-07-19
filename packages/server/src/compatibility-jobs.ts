import {
  buildTargetProfiles,
  enqueueJob,
  listDevices,
  listTargets,
  now,
  readCompatibilityMatrix,
  resolveCompatibilityMatrix,
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

export async function enqueueCompatibilityBatch(
  scope: RequestContext,
  input: unknown,
  options: { kind: "compatibility" | "soak"; maxRepetitions: number; maxJobs: number },
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "JSON object required");
  }
  const body = input as CompatibilityBatchInput;
  if (!body.recipe || !body.matrixId) {
    throw new HttpError(400, "recipe and matrixId are required");
  }
  const matrix = await readCompatibilityMatrix(scope.projectId, body.matrixId);
  if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
  const profiles = buildTargetProfiles({
    devices: await listDevices().catch(() => []),
    targets: await listTargets(),
  });
  const expansion = resolveCompatibilityMatrix(matrix, profiles);
  if (expansion.profiles.length === 0) {
    const details = expansion.excluded.map((item) => item.reason).join("; ");
    throw new HttpError(
      400,
      `Compatibility matrix “${matrix.name}” matched no targets${details ? ` (${details})` : ""}`,
    );
  }
  for (const profile of expansion.profiles) await assertTargetControl(scope, profile.targetId);
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
      enqueueJob({
        recipe: body.recipe,
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
        ownerId: scope.subject,
      }),
    ),
  );
  return { matrix: expansion, jobs, batchId, repetitions };
}
