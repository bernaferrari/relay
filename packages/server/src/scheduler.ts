import {
  buildTargetProfiles,
  enqueueJob,
  freezeRecipeGraph,
  listDevices,
  listSchedules,
  listTargets,
  markScheduleRun,
  prepareRunMatrix,
  readProjectVariables,
  readRecipe,
  referencedVariableIds,
  resolveScheduledTargetProfile,
  runWithOperationContext,
  sensitiveInputNames,
} from "@relay/core";

export async function runDueSchedules(at = Date.now()): Promise<void> {
  const schedules = await listSchedules();
  const targetProfiles = buildTargetProfiles({
    devices: await listDevices().catch(() => []),
    targets: await listTargets(),
    observedAt: at,
  });
  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.nextRunAt > at) continue;
    try {
      const recipe = await readRecipe(schedule.recipeId);
      if (!recipe || recipe.quarantined) {
        await markScheduleRun(schedule.id, at);
        continue;
      }
      const recipeGraph = await freezeRecipeGraph(recipe);
      const variables = await readProjectVariables(schedule.projectId);
      const matrix = await prepareRunMatrix({
        variables: variables.value,
        variableIds: referencedVariableIds(recipeGraph, variables.value),
        repetitions: schedule.repetitions,
        seed: at,
      });
      const targetProfile = resolveScheduledTargetProfile(schedule, targetProfiles);
      for (const item of matrix.cases) {
        runWithOperationContext(
          {
            schemaVersion: 1,
            actorId: "system:scheduler",
            actorKind: "system",
            organizationId: "local",
            projectId: schedule.projectId,
            operationId: "job.create",
            requestId: `schedule:${schedule.id}:${at}:${item.index}`,
            idempotencyKey: `schedule:${schedule.id}:${at}:${item.index}`,
            issuedAt: at,
          },
          () =>
            enqueueJob({
              recipe: schedule.recipeId,
              recipeSnapshot: recipe,
              recipeGraph,
              ...(schedule.targetKind === "browser"
                ? { targetKind: "browser" as const, browserTargetId: schedule.targetId }
                : {
                    targetKind: "device" as const,
                    serial: schedule.targetId,
                    platform: schedule.platform === "ios" ? "ios" : "android",
                  }),
              variables: item.values,
              sensitiveInputNames: sensitiveInputNames(variables.value, item.values),
              ...(targetProfile ? { targetProfile } : {}),
              batchId: matrix.id,
              caseIndex: item.index,
              caseCount: matrix.cases.length,
              artifacts: [
                {
                  kind: "schedule",
                  capturedAt: at,
                  data: {
                    scheduleId: schedule.id,
                    matrixId: matrix.id,
                    provenance: item.provenance,
                    targetProfile: targetProfile ?? null,
                    targetProfileStatus: targetProfile ? "observed" : "unavailable",
                  },
                },
              ],
              projectId: schedule.projectId,
              ownerId: "scheduler",
            }),
        );
      }
      // Preparation and queueing succeeded. A missing private input or other
      // expansion failure must remain due so it is visible and recoverable.
      await markScheduleRun(schedule.id, at);
    } catch {
      // One bad schedule must not prevent other due schedules from queueing.
      continue;
    }
  }
}

export function startScheduler(intervalMs = 30_000): { close: () => void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runDueSchedules().finally(() => {
      running = false;
    });
  }, intervalMs);
  timer.unref?.();
  return { close: () => clearInterval(timer) };
}
