import { now } from "./events.js";
import type { Device } from "./device.js";
import { cooperativeCheckpoint, JobCancelledError } from "./control.js";
import { readRecipe, describeRecipeStep, glyphsForStep } from "./recipes.js";
import { applyCoverageOutcomeToTrace } from "./coverage-step-outcome.js";
import { resolveRecipeStep, runRecipeStep } from "./recipe-runner.js";
import type { RecipeRuntimeState, RecipeStepContext } from "./recipe-runner-context.js";
import { finalizeDeferredChecksForJob } from "./session-campaign-finalization.js";
import type { TraceStep } from "./trace.js";
import type { TestJob } from "./session-contract.js";
import { isTargetUnavailableError } from "./target-unavailable.js";
import { captureAutomaticState } from "./session-automatic-evidence.js";
import {
  finishCheckedStep,
  finishStep,
  observeStepActions,
  openStep,
} from "./session-trace-steps.js";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import { parseAppMapCombineCellExecutionIntentArtifact } from "./app-map-combine-cell-intent.js";
import { attachDestinationRepairProposals } from "./session-repair-attachment.js";
import { automaticEvidencePhases } from "./session-evidence-phases.js";

function isJobCancellation(error: unknown): boolean {
  return (
    error instanceof JobCancelledError ||
    (error instanceof Error && error.name === "JobCancelledError")
  );
}

/** Run a frozen recipe as traced, cancellable device actions. */
export async function runRecipeSteps(
  job: TestJob,
  device: Device,
  pushLog: (line: string) => void,
  setCurrentStep: (step: TraceStep | undefined) => void,
): Promise<void> {
  const recipeId = job.recipeId;
  if (!recipeId) throw new Error("recipe job has no recipeId");
  const recipe = job.recipeSnapshot ?? (await readRecipe(recipeId));
  if (!recipe) throw new Error(`recipe not found: ${recipeId}`);
  if (!job.recipeSnapshot) job.recipeSnapshot = structuredClone(recipe);
  job.resolvedInputs = { ...recipe.variables, ...job.resolvedInputs };
  const executionIntent = parseAppMapTestExecutionIntentArtifact(
    job.artifacts.find((artifact) => artifact.kind === "app-map-test-execution-intent"),
  );
  const combineIntent = parseAppMapCombineCellExecutionIntentArtifact(
    job.artifacts.find((artifact) => artifact.kind === "app-map-combine-cell-execution-intent"),
  );
  const destEndRecipeIds = (combineIntent?.child.plan ?? executionIntent?.plan)?.destEndRecipeIds;
  const runtime: RecipeRuntimeState = destEndRecipeIds?.length ? { destEndRecipeIds } : {};
  pushLog(`==> recipe: ${recipe.title} · ${recipe.steps.length} step(s)`);
  const execute = async (
    step: import("./recipes.js").RecipeStep,
    stepIndex: number,
    owner: typeof recipe,
    context: RecipeStepContext,
  ): Promise<void> => {
    await cooperativeCheckpoint(job.id);
    const recipeStepId = step.id?.trim() || `${owner.id}:${stepIndex + 1}`;
    const ts = openStep(job, {
      recipeId: owner.id,
      recipeStepId,
      kind: "Replay",
      tone: "acc",
      title: describeRecipeStep(step),
      glyphs: glyphsForStep(step),
      status: "running",
    });
    setCurrentStep(ts);
    try {
      observeStepActions(ts, glyphsForStep(step));
      const resolvedStep = resolveRecipeStep(step, job.resolvedInputs);
      job.artifacts.push({
        kind: "command-attempt",
        capturedAt: now(),
        data: { stepId: ts.id, command: resolvedStep },
      });
      const evidencePhases = automaticEvidencePhases(resolvedStep, owner.steps[stepIndex + 1]);
      if (evidencePhases.includes("before"))
        await captureAutomaticState(job, device, ts, "before", pushLog, runtime);
      const artifactStart = job.artifacts.length;
      // The Combine wrapper is setup/restore machinery. Frozen capture slots
      // start at the child Test root; nested authored module invocations remain
      // part of their identity. Share one cursor through every child root step.
      const childCaptureScope =
        combineIntent &&
        owner.id === combineIntent.wrapper.rootRecipeId &&
        resolvedStep.kind === "module" &&
        resolvedStep.recipeId === combineIntent.wrapper.childRootRecipeId
          ? {
              captureReview: {
                requirementId: combineIntent.child.plan.test.id,
                moduleCalls: new Map<string, number>(),
              },
              plannedSlots: combineIntent.child.plan.plannedSlots
                ? structuredClone([...combineIntent.child.plan.plannedSlots])
                : undefined,
            }
          : undefined;
      await runRecipeStep(device, resolvedStep, {
        ...context,
        runChild: async (child, index, childRecipe, childContext) => {
          try {
            await execute(child, index, childRecipe, {
              ...childContext,
              ...(childCaptureScope && childRecipe.id === combineIntent?.wrapper.childRootRecipeId
                ? childCaptureScope
                : {}),
            });
          } finally {
            setCurrentStep(ts);
          }
        },
      });
      applyCoverageOutcomeToTrace(ts, job.artifacts.slice(artifactStart));
      if (evidencePhases.includes("after"))
        await captureAutomaticState(job, device, ts, "after", pushLog, runtime);
      finishCheckedStep(ts, resolvedStep.check?.id, job.artifacts.slice(artifactStart));
    } catch (err) {
      if (!isJobCancellation(err) && !isTargetUnavailableError(err)) {
        await captureAutomaticState(job, device, ts, "after", pushLog, runtime);
      }
      await attachDestinationRepairProposals(job, err, runtime).catch(() => undefined);
      finishStep(ts, "error");
      throw err;
    }
  };
  for (const [index, step] of recipe.steps.entries()) {
    await execute(step, index, recipe, {
      log: pushLog,
      job,
      recipeGraph: job.recipeGraph,
      runtime,
      captureReview: {
        ...(executionIntent?.plan.test.id ? { requirementId: executionIntent.plan.test.id } : {}),
        moduleCalls: new Map(),
      },
      ...(executionIntent?.plan.plannedSlots
        ? { plannedSlots: [...executionIntent.plan.plannedSlots] }
        : {}),
    });
  }
  finalizeDeferredChecksForJob(job, pushLog, runtime);
  setCurrentStep(undefined);
}
