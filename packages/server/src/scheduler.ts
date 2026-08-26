import {
  buildTargetProfiles,
  freezeRecipeGraph,
  listDevices,
  listSchedules,
  listTargets,
  markScheduleFailure,
  markScheduleRun,
  prepareJobBatch,
  prepareCasePlan,
  publish,
  readProjectVariables,
  readRecipe,
  redactText,
  referencedVariableIds,
  resolveScheduledTargetProfile,
  runWithOperationContext,
  sensitiveInputNames,
} from "@relay/core";

export type SchedulerRuntime = {
  listSchedules: typeof listSchedules;
  listDevices: typeof listDevices;
  listTargets: typeof listTargets;
  readRecipe: typeof readRecipe;
  freezeRecipeGraph: typeof freezeRecipeGraph;
  readProjectVariables: typeof readProjectVariables;
  prepareCasePlan: typeof prepareCasePlan;
  prepareJobBatch: typeof prepareJobBatch;
  markScheduleRun: typeof markScheduleRun;
  markScheduleFailure: typeof markScheduleFailure;
};

const defaultRuntime: SchedulerRuntime = {
  listSchedules,
  listDevices,
  listTargets,
  readRecipe,
  freezeRecipeGraph,
  readProjectVariables,
  prepareCasePlan,
  prepareJobBatch,
  markScheduleRun,
  markScheduleFailure,
};

/** The server owns one scheduler process. This fence also protects direct
 * test/administrative polls from admitting the same occurrence concurrently. */
const activeScheduleAdmissions = new Set<string>();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runDueSchedules(
  at = Date.now(),
  runtime: SchedulerRuntime = defaultRuntime,
): Promise<void> {
  const schedules = await runtime.listSchedules();
  const targetProfiles = buildTargetProfiles({
    devices: await runtime.listDevices().catch(() => []),
    targets: await runtime.listTargets(),
    observedAt: at,
  });
  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.nextRunAt > at) continue;
    if (activeScheduleAdmissions.has(schedule.id)) continue;
    activeScheduleAdmissions.add(schedule.id);
    let staged: ReturnType<typeof prepareJobBatch> | undefined;
    try {
      const recipe = await runtime.readRecipe(schedule.recipeId);
      if (!recipe || recipe.quarantined) {
        throw new Error(
          recipe
            ? `Scheduled Test ${schedule.recipeId} is quarantined`
            : `Scheduled Test ${schedule.recipeId} was not found`,
        );
      }
      const recipeGraph = await runtime.freezeRecipeGraph(recipe);
      const variables = await runtime.readProjectVariables(schedule.projectId);
      // The schedule's persisted due time identifies this occurrence. Poll
      // timing must not change its seed or idempotency provenance.
      const scheduledAt = schedule.nextRunAt;
      const matrix = await runtime.prepareCasePlan({
        variables: variables.value,
        dataIds: referencedVariableIds(recipeGraph, variables.value),
        repetitions: schedule.repetitions,
        seed: scheduledAt,
      });
      const targetProfile = resolveScheduledTargetProfile(schedule, targetProfiles);
      const contexts = matrix.cases.map((item) => ({
        schemaVersion: 1 as const,
        actorId: "system:scheduler",
        actorKind: "system" as const,
        organizationId: "local",
        projectId: schedule.projectId,
        operationId: "job.create",
        requestId: `schedule:${schedule.id}:${scheduledAt}:${item.index}`,
        idempotencyKey: `schedule:${schedule.id}:${scheduledAt}:${item.index}`,
        issuedAt: at,
      }));
      const inputs = matrix.cases.map((item, index) => ({
        operationContext: contexts[index]!,
        input: {
          recipe: schedule.recipeId,
          recipeSnapshot: recipe,
          recipeGraph,
          ...(schedule.targetKind === "browser"
            ? { targetKind: "browser" as const, browserTargetId: schedule.targetId }
            : {
                targetKind: "device" as const,
                serial: schedule.targetId,
                platform: schedule.platform === "ios" ? ("ios" as const) : ("android" as const),
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
                scheduledAt,
                matrixId: matrix.id,
                provenance: item.provenance,
                targetProfile: targetProfile ?? null,
                targetProfileStatus: targetProfile ? "observed" : "unavailable",
              },
            },
          ],
          projectId: schedule.projectId,
          ownerId: "scheduler",
        },
      }));
      if (!contexts[0]) throw new Error("Scheduled Test produced no cases");
      staged = runWithOperationContext(contexts[0], () => runtime.prepareJobBatch(inputs));
      // All fallible batch activation happens before advancing the occurrence.
      // Dispatch is the scheduler's idempotent, no-throw queue transfer.
      staged.activate();
      await runtime.markScheduleRun(schedule.id, at);
      staged.dispatch();
    } catch (error) {
      let failureError = error;
      try {
        staged?.rollback();
      } catch (rollbackError) {
        failureError = new Error(
          `${messageOf(error)}; scheduled batch rollback failed: ${messageOf(rollbackError)}`,
        );
      }
      const failure = redactText(messageOf(failureError));
      try {
        await runtime.markScheduleFailure(schedule.id, failure, at);
      } catch (recordError) {
        publish({
          type: "error",
          at,
          message: `Scheduled Test ${schedule.id} failed (${failure}) and its failure record could not be persisted: ${redactText(messageOf(recordError))}`,
          where: "server.scheduler",
        });
      }
      // One bad schedule must not prevent other due schedules from queueing.
    } finally {
      activeScheduleAdmissions.delete(schedule.id);
    }
  }
}

export function startScheduler(
  intervalMs = 30_000,
  runDue: () => Promise<void> = runDueSchedules,
): { close: () => Promise<void> } {
  let closed = false;
  let running: Promise<void> | undefined;
  const run = () => {
    if (closed || running) return;
    running = runDue()
      // One failing scheduled poll must not produce an unhandled rejection or
      // prevent a later shutdown from observing that the poll has settled.
      .catch(() => undefined)
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return {
    close: async () => {
      closed = true;
      clearInterval(timer);
      await running;
    },
  };
}
