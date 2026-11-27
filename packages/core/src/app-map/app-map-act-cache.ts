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
import {
  mutateStoredAppMap,
  readAppMap,
  writeStoredAppMapObservation,
} from "../collaboration/collaboration.js";
import { mutateAppMap } from "./mutation.js";
import { appMapFail } from "./errors.js";
import type { AppMap, AppMapMutationContext } from "./model.js";
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

/** Steps whose saved path replayed successfully, keyed by the compiled
 * recipe step id. The count tracks how often the path served this run; the
 * timestamp is the latest replay completion. */
function actCacheHits(run: PersistedRun): Map<string, { count: number; at: number }> {
  const hits = new Map<string, { count: number; at: number }>();
  for (const artifact of run.artifacts) {
    const data = artifact.data as { source?: unknown; recipeStepId?: unknown } | undefined;
    if (
      artifact.kind !== "act-result" ||
      data?.source !== "cache" ||
      typeof data.recipeStepId !== "string"
    ) {
      continue;
    }
    const at = Number.isFinite(artifact.capturedAt) ? artifact.capturedAt : (run.finishedAt ?? 0);
    const previous = hits.get(data.recipeStepId);
    hits.set(data.recipeStepId, {
      count: (previous?.count ?? 0) + 1,
      at: Math.max(previous?.at ?? 0, at),
    });
  }
  return hits;
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

function visitSteps(
  list: AppMapScenarioTestStep[],
  each: (step: AppMapScenarioTestStep) => void,
): void {
  for (const step of list) {
    each(step);
    if (step.kind === "decision") {
      visitSteps(step.thenSteps, each);
      if (step.elseSteps) visitSteps(step.elseSteps, each);
    }
    if (step.kind === "loop") visitSteps(step.steps, each);
  }
}

function hasSavedPath(step: AppMapScenarioTestStep): boolean {
  return (
    step.kind === "instruction" &&
    step.binding.status === "unresolved" &&
    step.binding.cache !== undefined
  );
}

/** Forget saved actions a person no longer trusts, for one step or every
 * step of a test. The saved path is derived runtime data, not part of what
 * the test means, so validation and the step words stay exactly as they are;
 * the next run re-resolves from the model. */
export function forgetAppMapTestActions(
  map: AppMap,
  testId: string,
  context: AppMapMutationContext,
  stepId?: string,
): AppMap {
  const test = map.tests[testId];
  if (!test) appMapFail("missing-reference", `Test ${testId} does not exist`);
  let drops: Set<string>;
  if (stepId) {
    let found = false;
    visitSteps(test.steps, (step) => {
      if (step.id === stepId) found = true;
    });
    if (!found) {
      appMapFail("missing-reference", `Step ${stepId} does not exist in Test ${testId}`);
    }
    drops = new Set([stepId]);
  } else {
    drops = new Set<string>();
    visitSteps(test.steps, (step) => {
      if (hasSavedPath(step)) drops.add(step.id);
    });
  }
  const next = withoutCache(test.steps, drops);
  if (!next.changed) {
    appMapFail(
      "invalid-map",
      stepId
        ? `Step ${stepId} has no saved actions to forget`
        : `Test ${testId} has no saved actions to forget`,
    );
  }
  const summary =
    `Forgot saved actions for ${next.changed} plain-English step${next.changed === 1 ? "" : "s"}` +
    ` in ${test.name}`;
  return mutateAppMap(
    map,
    context,
    {
      eventType: "test.actions-dropped",
      subject: { kind: "test", id: testId },
      touched: [`test:${testId}:actions`],
      summary,
    },
    (draft) => {
      draft.tests = {
        ...draft.tests,
        [testId]: { ...test, steps: next.steps },
      };
    },
  );
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

/** Count replay servings into v2 entries. Hits are usage telemetry, so they
 * never rewrite the path itself and never touch legacy entries. */
export function withCacheHits(
  steps: AppMapScenarioTestStep[],
  hits: Map<string, { count: number; at: number }>,
): { steps: AppMapScenarioTestStep[]; changed: number } {
  let changed = 0;
  const visit = (list: AppMapScenarioTestStep[]): AppMapScenarioTestStep[] =>
    list.map((step) => {
      const hit = hits.get(step.id);
      if (
        hit &&
        step.kind === "instruction" &&
        step.binding.status === "unresolved" &&
        step.binding.cache !== undefined &&
        (step.binding.cache as { schemaVersion?: unknown }).schemaVersion === 2
      ) {
        const cached = step.binding.cache as PlainEnglishStepCacheV2;
        changed += hit.count;
        const cache: PlainEnglishStepCacheV2 = {
          ...cached,
          hits: (cached.hits ?? 0) + hit.count,
          lastHitAt: Math.max(cached.lastHitAt ?? 0, hit.at),
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

/** Count replay servings from a passed run into hit telemetry. Hits share the
 * write acceptance gate: a failed or blocked run proves nothing good about a
 * path, even one that happened to replay. The write is observational — it
 * must not advance the revision, because the revision is the user-visible
 * "the test changed" signal and usage telemetry is not a person editing the
 * test. Idempotent per run through the control store, so reprojection after a
 * restart never double-counts. */
export async function recordActCacheHitsFromRun(run: PersistedRun): Promise<number> {
  if (run.outcome !== "passed") return 0;
  const hits = actCacheHits(run);
  const plan = planOf(run);
  if (!hits.size || !plan || !run.projectId) return 0;
  const stepHits = new Map<string, { count: number; at: number }>();
  for (const [recipeStepId, hit] of hits) {
    const testStepId = plan.provenance.get(recipeStepId);
    if (!testStepId) continue;
    const previous = stepHits.get(testStepId);
    stepHits.set(testStepId, {
      count: (previous?.count ?? 0) + hit.count,
      at: Math.max(previous?.at ?? 0, hit.at),
    });
  }
  if (!stepHits.size) return 0;
  const idempotencyKey = `${run.projectId}:${plan.appMapId}:act-cache-hits:${run.id}`;
  let counted = 0;
  await writeStoredAppMapObservation(run.projectId, plan.appMapId, (map, store) => {
    if (store.idempotency(idempotencyKey) !== undefined) return undefined;
    store.upsertIdempotency(idempotencyKey, run.id);
    const test = map.tests[plan.testId];
    if (!test) return undefined;
    const next = withCacheHits(test.steps, stepHits);
    if (!next.changed) return undefined;
    counted = next.changed;
    return {
      ...map,
      tests: { ...map.tests, [plan.testId]: { ...test, steps: next.steps } },
    };
  });
  return counted;
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
