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
  resolveScheduledTargetProfile,
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
    const recipe = await readRecipe(schedule.recipeId);
    await markScheduleRun(schedule.id, at);
    if (!recipe || recipe.quarantined) continue;
    const recipeGraph = await freezeRecipeGraph(recipe);
    const variables = await readProjectVariables(schedule.projectId);
    const matrix = await prepareRunMatrix({
      variables: variables.value,
      repetitions: schedule.repetitions,
      seed: at,
    });
    const targetProfile = resolveScheduledTargetProfile(schedule, targetProfiles);
    for (const item of matrix.cases) {
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
      });
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
