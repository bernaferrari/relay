/**
 * After a run, remember the actions that carried out each plain-English
 * Action so the next run can replay them without asking a model. Only steps
 * that still run from the same words are updated; anything a person changed
 * since the run started is left alone.
 */
import type { AppMapScenarioTestStep, RecipeStep } from "@relay/protocol";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { mutateAppMap } from "./app-map/mutation.js";
import type { PersistedRun } from "./runs.js";

type ActResult = { recipeStepId: string; intent: string; source: string; steps: RecipeStep[] };

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

export function withCache(
  steps: AppMapScenarioTestStep[],
  updates: Map<string, ActResult>,
  runId: string,
  at: number,
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
        return {
          ...step,
          binding: { ...step.binding, cache: { steps: update.steps, runId, savedAt: at } },
        };
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

/** Save replayable actions from a finished run. Idempotent per run. */
export async function saveActCachesFromRun(run: PersistedRun): Promise<number> {
  const results = actResults(run);
  const plan = planOf(run);
  if (!results.length || !plan || !run.projectId) return 0;
  const updates = new Map<string, ActResult>();
  for (const result of results) {
    const testStepId = plan.provenance.get(result.recipeStepId);
    if (testStepId) updates.set(testStepId, result);
  }
  if (!updates.size) return 0;
  const current = await readAppMap(run.projectId, plan.appMapId);
  if (!current?.tests[plan.testId] || current.activity[`act-cache-${run.id}`]) return 0;
  let saved = 0;
  await mutateStoredAppMap(run.projectId, plan.appMapId, (map) => {
    const test = map.tests[plan.testId];
    if (!test || map.activity[`act-cache-${run.id}`]) return map;
    const at = Math.max(Date.now(), map.updatedAt);
    const next = withCache(test.steps, updates, run.id, at);
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
