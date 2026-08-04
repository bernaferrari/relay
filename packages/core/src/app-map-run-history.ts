import type { AppMapCompiledFlow, TargetProfile } from "@relay/protocol";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { listPersistedRuns, type PersistedRun } from "./runs.js";
import { recordAppMapRun } from "./app-map/run-operations.js";

function compiledPlan(run: PersistedRun): AppMapCompiledFlow | null {
  const value = run.artifacts.find((artifact) => artifact.kind === "app-map-flow-plan")?.data;
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<AppMapCompiledFlow>;
  return plan.schemaVersion === 1 &&
    typeof plan.appMapId === "string" &&
    typeof plan.appMapRevision === "number" &&
    typeof plan.flow?.id === "string" &&
    Array.isArray(plan.connections)
    ? (value as AppMapCompiledFlow)
    : null;
}

function fallbackProfile(run: PersistedRun): TargetProfile | null {
  const targetId = run.serial?.trim();
  const platform =
    run.platform === "ios" || run.platform === "android" || run.platform === "browser"
      ? run.platform
      : null;
  if (!targetId || !platform) return null;
  return {
    id: `${platform}:${targetId}`,
    targetId,
    source: platform === "browser" ? "browser" : "device",
    platform,
    name: run.deviceName?.trim() || targetId,
    capabilities: [],
    observedAt: run.startedAt ?? run.queuedAt,
  };
}

function failedConnectionId(run: PersistedRun, plan: AppMapCompiledFlow): string | undefined {
  const failedStep = run.steps.find((step) => step.status === "error");
  if (!failedStep) return undefined;
  return plan.connections.find(
    (connection) =>
      failedStep.index >= connection.compiledStepRange[0] &&
      failedStep.index < connection.compiledStepRange[1],
  )?.connectionId;
}

/** Reconcile a durable report into its App Map. Safe to call after restarts:
 * an already projected run is a successful no-op. */
export async function projectPersistedAppMapRun(run: PersistedRun): Promise<boolean> {
  const plan = compiledPlan(run);
  const targetProfile = run.targetProfile ?? fallbackProfile(run);
  const outcome = run.outcome;
  const finishedAt = run.finishedAt;
  if (!plan || !targetProfile || !outcome || finishedAt === undefined || !run.projectId)
    return false;

  const current = await readAppMap(run.projectId, plan.appMapId);
  if (!current || current.runs[run.id]) return false;
  await mutateStoredAppMap(run.projectId, plan.appMapId, (map) => {
    const operation = run.executionProvenance;
    const at = Math.max(map.updatedAt, finishedAt);
    return recordAppMapRun(
      map,
      {
        runId: run.id,
        flowId: plan.flow.id,
        appMapRevision: plan.appMapRevision,
        targetProfile,
        outcome,
        startedAt: run.startedAt ?? run.queuedAt,
        finishedAt,
        ...(outcome === "passed" ? {} : { connectionId: failedConnectionId(run, plan) }),
        evidenceIds: [`run:${run.id}`],
      },
      {
        expectedRevision: map.revision,
        eventId: `run-finished-${run.id}`,
        actorId: operation?.actorId ?? run.ownerId ?? "system:runner",
        actorKind: operation?.actorKind ?? "system",
        at,
      },
    );
  });
  return true;
}

/** Repair the rebuildable App Map history projection from immutable reports.
 * This closes crashes between report commit and map commit without a migration
 * format or a second source of truth. */
export async function reconcilePersistedAppMapRuns(limit = 1_000): Promise<{
  projected: number;
  skipped: number;
  failed: number;
}> {
  const runs = (await listPersistedRuns(limit)).sort(
    (left, right) => (left.finishedAt ?? left.writtenAt) - (right.finishedAt ?? right.writtenAt),
  );
  let projected = 0;
  let skipped = 0;
  let failed = 0;
  for (const run of runs) {
    try {
      if (await projectPersistedAppMapRun(run)) projected += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }
  return { projected, skipped, failed };
}
