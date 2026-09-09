import type {
  AppMapCompiledFlow,
  ConnectionExecutionObservation,
  TargetProfile,
} from "@relay/protocol";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { listPersistedRuns, type PersistedRun } from "./runs.js";
import { recordAppMapRun, recordAppMapTestValidation } from "./app-map/run-operations.js";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { readFrameTreeNodes } from "./run-frame-tree.js";

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

function compiledTestProvenance(
  run: PersistedRun,
): { appMapId: string; appMapRevision: number; testId: string } | undefined {
  const value = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan")?.data;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as {
    appMapId?: unknown;
    appMapRevision?: unknown;
    test?: { id?: unknown };
  };
  return typeof candidate.appMapId === "string" &&
    Number.isSafeInteger(candidate.appMapRevision) &&
    typeof candidate.test?.id === "string"
    ? {
        appMapId: candidate.appMapId,
        appMapRevision: candidate.appMapRevision as number,
        testId: candidate.test.id,
      }
    : undefined;
}

function runLocale(run: PersistedRun): string | undefined {
  for (const key of ["language", "locale", "app_locale"]) {
    const value = run.resolvedInputs[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function planScreenSteps(run: PersistedRun): Array<{ id: string; screenId: string }> {
  const artifact = run.artifacts.find((item) => item.kind === "app-map-test-plan")?.data;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return [];
  const plan = artifact as {
    rootRecipeId?: unknown;
    recipes?: Record<string, { steps?: unknown[] }>;
  };
  const result: Array<{ id: string; screenId: string }> = [];
  const visit = (
    items: unknown[],
    traceId?: string,
    active = new Set<string>(),
  ): string | undefined => {
    let lastScreen: string | undefined;
    for (const value of items) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const step = value as Record<string, unknown>;
      if (
        step.kind === "expect-screen" &&
        typeof step.id === "string" &&
        typeof step.screenId === "string"
      ) {
        if (!traceId && active.size === 0) result.push({ id: step.id, screenId: step.screenId });
        lastScreen = step.screenId;
      }
      if (
        step.kind === "module" &&
        typeof step.id === "string" &&
        typeof step.recipeId === "string"
      ) {
        if (!active.has(step.recipeId)) {
          const nestedActive = new Set(active).add(step.recipeId);
          const nestedLast = visit(
            plan.recipes?.[step.recipeId]?.steps ?? [],
            undefined,
            nestedActive,
          );
          if (nestedLast) {
            result.push({ id: step.id, screenId: nestedLast });
            lastScreen = nestedLast;
          }
        }
      }
      for (const key of ["thenSteps", "elseSteps", "steps"]) {
        if (Array.isArray(step[key])) {
          const nestedLast = visit(step[key] as unknown[], traceId);
          if (nestedLast) lastScreen = nestedLast;
        }
      }
    }
    return lastScreen;
  };
  visit(plan.recipes?.[String(plan.rootRecipeId)]?.steps ?? []);
  return result;
}

async function promoteSuccessfulTestCaptures(
  run: PersistedRun,
  appMapId: string,
  targetProfile: TargetProfile | null,
): Promise<void> {
  if (run.outcome !== "passed" || !targetProfile || !run.dir) return;
  const locale = runLocale(run);
  const expected = planScreenSteps(run);
  const captures: Array<{ screenId: string; frame: PersistedRun["frames"][number] }> = [];
  for (const item of expected) {
    const trace = run.steps.find((step) => step.recipeStepId === item.id);
    for (const frame of trace?.frames ?? []) captures.push({ screenId: item.screenId, frame });
  }
  if (!captures.length) return;
  const latestByScreen = new Map<string, (typeof captures)[number]>();
  for (const capture of captures) {
    const previous = latestByScreen.get(capture.screenId);
    if (!previous || capture.frame.capturedAt >= previous.frame.capturedAt)
      latestByScreen.set(capture.screenId, capture);
  }
  const promoted = [] as Array<{ screenId: string; variant: Record<string, unknown> }>;
  for (const capture of latestByScreen.values()) {
    const png = await readFile(join(run.dir, capture.frame.path)).catch(() => undefined);
    if (!png) continue;
    const screenshot = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: capture.frame.capturedAt,
      data: png,
      mime: "image/png",
    });
    const nodes = await readFrameTreeNodes(run.dir, capture.frame.path);
    const tree = nodes?.length
      ? await persistAuthoringEvidence({
          kind: "snapshot",
          capturedAt: capture.frame.capturedAt,
          data: JSON.stringify({ nodes }),
          mime: "application/json",
        })
      : undefined;
    promoted.push({
      screenId: capture.screenId,
      variant: {
        id: `run-${run.id}-${capture.screenId}-${capture.frame.path.replace(/[^a-z0-9]/gi, "-")}`,
        organizationId: "",
        projectId: run.projectId ?? "",
        appMapId,
        screenId: capture.screenId,
        targetProfile: structuredClone(targetProfile),
        evidenceIds: [screenshot.id, ...(tree ? [tree.id] : [])],
        evidenceUris: [screenshot.uri, ...(tree ? [tree.uri] : [])],
        screenshotUri: screenshot.uri,
        ...(tree
          ? {
              rawAccessibilityTree: {
                id: tree.id,
                uri: tree.uri,
                sha256: tree.sha256!,
                mime: "application/json",
                bytes: tree.bytes!,
                capturedAt: capture.frame.capturedAt,
              },
            }
          : {}),
        captureProvenance: {
          kind: "run",
          runId: run.id,
          capturedAt: capture.frame.capturedAt,
          ...(locale ? { locale } : {}),
          screenshotEvidenceId: screenshot.id,
          ...(tree ? { accessibilityEvidenceId: tree.id } : {}),
        },
        createdAt: capture.frame.capturedAt,
        updatedAt: capture.frame.capturedAt,
      },
    });
  }
  if (!promoted.length) return;
  await mutateStoredAppMap(run.projectId!, appMapId, (map) => {
    const scope = {
      organizationId: map.organizationId,
      projectId: map.projectId,
      appMapId: map.id,
    };
    const additions = promoted.filter(({ screenId }) => {
      const screen = map.screens[screenId];
      return Boolean(
        screen &&
        !screen.variantIds.some((id) => {
          const existing = map.screenVariants[id];
          return (
            existing?.targetProfile.id === targetProfile.id &&
            (existing.captureProvenance?.locale ?? "") === (locale ?? "")
          );
        }) &&
        !screen.variantIds.some(
          (id) =>
            map.screenVariants[id]?.captureProvenance?.kind === "run" &&
            map.screenVariants[id]?.captureProvenance?.runId === run.id,
        ),
      );
    });
    if (!additions.length) return map;
    const next = structuredClone(map);
    for (const { screenId, variant } of additions) {
      const complete = { ...variant, ...scope } as (typeof next.screenVariants)[string];
      next.screenVariants[complete.id] = complete;
      next.screens[screenId]!.variantIds = [
        ...next.screens[screenId]!.variantIds,
        complete.id,
      ].sort();
    }
    next.revision += 1;
    next.updatedAt = Math.max(
      next.updatedAt,
      ...additions.map(({ variant }) => Number(variant.updatedAt)),
    );
    return next;
  });
}

async function recordSuccessfulTestValidation(
  run: PersistedRun,
  provenance: { appMapId: string; appMapRevision: number; testId: string },
): Promise<boolean> {
  if (run.outcome !== "passed" || run.finishedAt === undefined || !run.projectId) return false;
  const current = await readAppMap(run.projectId, provenance.appMapId);
  if (!current || current.revision !== provenance.appMapRevision) return false;
  const test = current.tests[provenance.testId];
  if (!test) return false;
  await mutateStoredAppMap(run.projectId, provenance.appMapId, (map) => {
    const operation = run.executionProvenance;
    return recordAppMapTestValidation(
      map,
      { ...provenance, runId: run.id, validatedAt: run.finishedAt! },
      {
        expectedRevision: map.revision,
        eventId: `test-validated-${run.id}`,
        actorId: operation?.actorId ?? run.ownerId ?? "system:runner",
        actorKind: operation?.actorKind ?? "system",
        at: Math.max(map.updatedAt, run.finishedAt!),
      },
    );
  });
  return true;
}

export function connectionObservationsFromPersistedRun(
  run: PersistedRun,
): ConnectionExecutionObservation[] {
  const latestByCheck = new Map<string, ConnectionExecutionObservation>();
  for (const artifact of run.artifacts ?? []) {
    if (
      artifact.kind !== "campaign-check-result" ||
      !artifact.data ||
      typeof artifact.data !== "object" ||
      Array.isArray(artifact.data)
    ) {
      continue;
    }
    const data = artifact.data as Record<string, unknown>;
    const checkId = typeof data.id === "string" ? data.id.trim() : "";
    const dependencies = data.transitionDependencies;
    const startedAt = data.startedAt;
    const finishedAt = data.finishedAt;
    const status = data.status;
    if (
      !checkId ||
      !Array.isArray(dependencies) ||
      dependencies.length !== 1 ||
      data.cleanup !== undefined ||
      (status !== "passed" && status !== "failed") ||
      !Number.isSafeInteger(startedAt) ||
      !Number.isSafeInteger(finishedAt) ||
      (finishedAt as number) < (startedAt as number)
    ) {
      continue;
    }
    const dependency = dependencies[0];
    const connectionId =
      dependency && typeof dependency === "object" && !Array.isArray(dependency)
        ? (dependency as Record<string, unknown>).connectionId
        : undefined;
    if (typeof connectionId !== "string" || !connectionId.trim()) continue;
    latestByCheck.set(checkId, {
      connectionId: connectionId.trim(),
      outcome: status,
      durationMs: (finishedAt as number) - (startedAt as number),
      observedAt: finishedAt as number,
    });
  }
  return [...latestByCheck.values()].sort(
    (left, right) =>
      left.connectionId.localeCompare(right.connectionId) || left.observedAt - right.observedAt,
  );
}

/** Reconcile a durable report into its App Map. Safe to call after restarts:
 * an already projected run is a successful no-op. */
export async function projectPersistedAppMapRun(run: PersistedRun): Promise<boolean> {
  const testProvenance = compiledTestProvenance(run);
  if (testProvenance && !compiledPlan(run)) {
    const projected = await recordSuccessfulTestValidation(run, testProvenance);
    if (projected)
      await promoteSuccessfulTestCaptures(
        run,
        testProvenance.appMapId,
        run.targetProfile ?? fallbackProfile(run),
      );
    return projected;
  }
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
        connectionObservations: connectionObservationsFromPersistedRun(run),
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
  await promoteSuccessfulTestCaptures(run, plan.appMapId, targetProfile);
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
