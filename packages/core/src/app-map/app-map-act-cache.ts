/**
 * After a run, remember the actions that carried out each plain-English
 * Action so the next run can replay them without asking a model. Only steps
 * that still run from the same words are updated; anything a person changed
 * since the run started is left alone.
 *
 * The acceptance gate lives in projectPersistedAppMapRun: a resolution is
 * only ever cached from a passed run. A failed run instead drops the saved
 * path of every step that missed, because that path is empirically stale and
 * a wrong re-resolution cached now would cement a red test into a false green
 * later. Blocked runs prove nothing in either direction.
 */
import type { AppMapScenarioTestStep, PlainEnglishStepCacheV2, RecipeStep } from "@relay/protocol";
import { mutateStoredAppMap, readAppMap } from "../collaboration/collaboration.js";
import { mutateAppMap } from "./mutation.js";
import type { PersistedRun } from "../run/run-store.js";
import { sanitizedActCacheSteps, type ActCacheStepResolution } from "./act-cache-steps.js";

type ActResult = {
  recipeStepId: string;
  intent: string;
  source: string;
  steps: RecipeStep[];
  resolutions?: (ActCacheStepResolution | null)[];
};

function actResults(run: PersistedRun): ActResult[] {
  return run.artifacts.flatMap((artifact) => {
    const data = artifact.data as Partial<ActResult> | undefined;
    return artifact.kind === "act-result" &&
      data?.source === "model" &&
      typeof data.recipeStepId === "string" &&
      typeof data.intent === "string" &&
      Array.isArray(data.steps) &&
      data.steps.length > 0 &&
      data.steps.length <= 40
      ? [data as ActResult]
      : [];
  });
}

/** Steps whose saved path no longer fit during this run, keyed by the
 * compiled recipe step id so lineage survives document edits. */
function actCacheMisses(run: PersistedRun): Map<string, string> {
  const misses = new Map<string, string>();
  for (const artifact of run.artifacts) {
    const data = artifact.data as
      | { action?: unknown; recipeStepId?: unknown; reason?: unknown }
      | undefined;
    if (
      artifact.kind === "act-decision" &&
      data?.action === "cache-miss" &&
      typeof data.recipeStepId === "string"
    ) {
      misses.set(
        data.recipeStepId,
        typeof data.reason === "string" ? data.reason : "the saved path no longer matched",
      );
    }
  }
  return misses;
}

function planOf(
  run: PersistedRun,
): { appMapId: string; testId: string; provenance: Map<string, string> } | undefined {
  const plan = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan")?.data as
    | {
        appMapId?: unknown;
        test?: { id?: unknown };
        stepProvenance?: Array<{ recipeStepId?: unknown; testStepId?: unknown }>;
      }
    | undefined;
  if (typeof plan?.appMapId !== "string" || typeof plan.test?.id !== "string") return undefined;
  const provenance = new Map<string, string>();
  for (const item of plan.stepProvenance ?? [])
    if (typeof item.recipeStepId === "string" && typeof item.testStepId === "string")
      provenance.set(item.recipeStepId, item.testStepId);
  return { appMapId: plan.appMapId, testId: plan.test.id, provenance };
}

export type ActCacheUpdate = {
  intent: string;
  steps: RecipeStep[];
  resolution: PlainEnglishStepCacheV2["resolution"];
  /** The saved path missed before this resolution; carries its miss reason. */
  missedReason?: string;
};

export type ActCacheTargetContext = {
  targetKind: "browser" | "device";
  platform?: "android" | "ios";
  viewport?: { width: number; height: number };
};

export function withoutCache(
  steps: AppMapScenarioTestStep[],
  drops: Set<string>,
): { steps: AppMapScenarioTestStep[]; changed: number } {
  let changed = 0;
  const visit = (list: AppMapScenarioTestStep[]): AppMapScenarioTestStep[] =>
    list.map((step) => {
      if (
        drops.has(step.id) &&
        step.kind === "instruction" &&
        step.binding.status === "unresolved" &&
        step.binding.cache !== undefined
      ) {
        changed += 1;
        const { cache: _cache, ...binding } = step.binding;
        return { ...step, binding };
      }
      if (step.kind === "decision")
        return {
          ...step,
          thenSteps: visit(step.thenSteps),
          ...(step.elseSteps ? { elseSteps: visit(step.elseSteps) } : {}),
        };
      if (step.kind === "loop") return { ...step, steps: visit(step.steps) };
      return step;
    });
  return { steps: visit(steps), changed };
}

export function withCache(
  steps: AppMapScenarioTestStep[],
  updates: Map<string, ActCacheUpdate>,
  context: ActCacheTargetContext & { runId: string; at: number },
): { steps: AppMapScenarioTestStep[]; changed: number } {
  let changed = 0;
  const visit = (list: AppMapScenarioTestStep[]): AppMapScenarioTestStep[] =>
    list.map((step) => {
      const update = updates.get(step.id);
      if (
        update &&
        step.kind === "instruction" &&
        step.binding.status === "unresolved" &&
        step.binding.fromText &&
        step.intent.trim() === update.intent.trim()
      ) {
        changed += 1;
        const previous = step.binding.cache;
        const cache: PlainEnglishStepCacheV2 = {
          schemaVersion: 2,
          steps: update.steps,
          runId: context.runId,
          savedAt: context.at,
          targetKind: context.targetKind,
          ...(context.platform ? { platform: context.platform } : {}),
          ...(context.viewport ? { viewport: context.viewport } : {}),
          resolution: update.resolution,
          verification: { runOutcome: "passed" },
          ...(update.missedReason && previous
            ? {
                healedFrom: {
                  runId: previous.runId,
                  savedAt: previous.savedAt,
                  reason: update.missedReason,
                },
              }
            : {}),
        };
        return { ...step, binding: { ...step.binding, cache } };
      }
      if (step.kind === "decision")
        return {
          ...step,
          thenSteps: visit(step.thenSteps),
          ...(step.elseSteps ? { elseSteps: visit(step.elseSteps) } : {}),
        };
      if (step.kind === "loop") return { ...step, steps: visit(step.steps) };
      return step;
    });
  return { steps: visit(steps), changed };
}

function runCacheTarget(run: PersistedRun): ActCacheTargetContext | undefined {
  // Phase 1 caches browser resolutions only: web semantic resolution is
  // strict, while native targets can still degrade a stale key to a silent
  // coordinate tap that never misses and therefore never re-resolves.
  if (run.platform !== "browser") return undefined;
  const viewport = run.targetProfile?.viewport;
  return {
    targetKind: "browser",
    ...(viewport ? { viewport: { width: viewport.width, height: viewport.height } } : {}),
  };
}

/** Save replayable actions from a passed run. Idempotent per run. */
export async function saveActCachesFromRun(run: PersistedRun): Promise<number> {
  if (run.outcome !== "passed") return 0;
  const target = runCacheTarget(run);
  if (!target) return 0;
  const results = actResults(run);
  const plan = planOf(run);
  if (!results.length || !plan || !run.projectId) return 0;
  const misses = actCacheMisses(run);
  const updates = new Map<string, ActCacheUpdate>();
  for (const result of results) {
    const testStepId = plan.provenance.get(result.recipeStepId);
    if (!testStepId) continue;
    const clean = sanitizedActCacheSteps(result.steps, result.resolutions ?? undefined);
    if (!clean) continue;
    const missedReason = misses.get(result.recipeStepId);
    updates.set(testStepId, {
      intent: result.intent,
      steps: clean.steps,
      resolution: clean.resolution,
      ...(missedReason ? { missedReason } : {}),
    });
  }
  if (!updates.size) return 0;
  const current = await readAppMap(run.projectId, plan.appMapId);
  const currentTest = current?.tests[plan.testId];
  if (!current || !currentTest || current.activity[`act-cache-${run.id}`]) return 0;
  // mutateStoredAppMap rejects a no-op transform, so a run whose resolutions
  // no longer match the document (renamed words, another writer) is filtered
  // against the snapshot first; the mutation then re-proves it inside.
  const preview = withCache(currentTest.steps, updates, {
    ...target,
    runId: run.id,
    at: current.updatedAt,
  });
  if (!preview.changed) return 0;
  let saved = 0;
  await mutateStoredAppMap(run.projectId, plan.appMapId, (map) => {
    const test = map.tests[plan.testId];
    if (!test || map.activity[`act-cache-${run.id}`]) return map;
    const at = Math.max(Date.now(), map.updatedAt);
    const next = withCache(test.steps, updates, { ...target, runId: run.id, at });
    if (!next.changed) return map;
    saved = next.changed;
    return mutateAppMap(
      map,
      {
        expectedRevision: map.revision,
        eventId: `act-cache-${run.id}`,
        actorId: "system:runner",
        actorKind: "system",
        at,
      },
      {
        eventType: "test.actions-saved",
        subject: { kind: "test", id: plan.testId },
        touched: [`test:${plan.testId}:actions`],
        summary: `Saved actions for ${next.changed} plain-English step${next.changed === 1 ? "" : "s"}`,
      },
      (draft) => {
        draft.tests[plan.testId] = { ...draft.tests[plan.testId]!, steps: next.steps };
      },
    );
  });
  return saved;
}

/** Drop the saved path of every step that missed in a failed run. The miss
 * proves the path is stale; the failure proves the re-resolution must not be
 * trusted, so the next run asks the model directly. Idempotent per run. */
export async function dropStaleActCachesFromRun(run: PersistedRun): Promise<number> {
  if (run.outcome !== "product-failure") return 0;
  const plan = planOf(run);
  const misses = actCacheMisses(run);
  if (!plan || !misses.size || !run.projectId) return 0;
  const drops = new Set<string>();
  for (const recipeStepId of misses.keys()) {
    const testStepId = plan.provenance.get(recipeStepId);
    if (testStepId) drops.add(testStepId);
  }
  if (!drops.size) return 0;
  const eventId = `act-cache-drop-${run.id}`;
  const current = await readAppMap(run.projectId, plan.appMapId);
  const currentTest = current?.tests[plan.testId];
  if (!current || !currentTest || current.activity[eventId]) return 0;
  if (!withoutCache(currentTest.steps, drops).changed) return 0;
  let dropped = 0;
  await mutateStoredAppMap(run.projectId, plan.appMapId, (map) => {
    const test = map.tests[plan.testId];
    if (!test || map.activity[eventId]) return map;
    const next = withoutCache(test.steps, drops);
    if (!next.changed) return map;
    const at = Math.max(Date.now(), map.updatedAt);
    dropped = next.changed;
    return mutateAppMap(
      map,
      {
        expectedRevision: map.revision,
        eventId,
        actorId: "system:runner",
        actorKind: "system",
        at,
      },
      {
        eventType: "test.actions-dropped",
        subject: { kind: "test", id: plan.testId },
        touched: [`test:${plan.testId}:actions`],
        summary: `Dropped stale actions for ${next.changed} plain-English step${next.changed === 1 ? "" : "s"}`,
      },
      (draft) => {
        draft.tests[plan.testId] = { ...draft.tests[plan.testId]!, steps: next.steps };
      },
    );
  });
  return dropped;
}
