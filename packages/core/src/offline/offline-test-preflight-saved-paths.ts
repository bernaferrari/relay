/** Saved-path coverage for a frozen compiled test. This is deliberately a
 * shape-only, device-free accounting pass: it reports what would be tried
 * first live, never whether the current screen already satisfies the step. */
import type {
  AppMapCompiledTest,
  OfflineTestPreflightSavedPathCoverage,
  OfflineTestPreflightSavedPathStep,
  RecipeStep,
} from "@relay/protocol";
import { savedPathStepsAreExecutable } from "../app-map/act-cache-steps.js";

function savedPathStatus(
  step: Extract<RecipeStep, { kind: "act" | "evaluate-visual" }>,
): Pick<OfflineTestPreflightSavedPathStep, "status" | "savedPathSteps" | "detail"> {
  const kind = step.kind === "act" ? "action" : "check";
  if (Array.isArray(step.cached) && savedPathStepsAreExecutable(step.cached, kind)) {
    return {
      status: "covered",
      savedPathSteps: step.cached.length,
      detail: `Replays ${step.cached.length} saved step${step.cached.length === 1 ? "" : "s"} without the model.`,
    };
  }
  return {
    status: "needs-model",
    ...(step.cached?.length
      ? { detail: "The saved path is incomplete or unsafe, so this step needs the model live." }
      : {
          detail: "No saved path is available for this target, so this step needs the model live.",
        }),
  };
}

export function savedPathCoverageForCompiledPlan(
  plan: AppMapCompiledTest,
): OfflineTestPreflightSavedPathCoverage | undefined {
  const testStepByRecipeStep = new Map<string, string>();
  for (const item of plan.stepProvenance ?? []) {
    if (!item.recipeStepId) continue;
    testStepByRecipeStep.set(`${item.recipeId}\0${item.recipeStepId}`, item.testStepId);
  }
  const steps: OfflineTestPreflightSavedPathStep[] = [];
  for (const recipeId of Object.keys(plan.recipes).sort()) {
    const recipe = plan.recipes[recipeId]!;
    for (const [stepIndex, step] of recipe.steps.entries()) {
      if (step.kind !== "act" && step.kind !== "evaluate-visual") continue;
      const recipeStepId = step.id ?? `${recipeId}:${stepIndex + 1}`;
      const testStepId = testStepByRecipeStep.get(`${recipeId}\0${recipeStepId}`);
      steps.push({
        recipeId,
        recipeStepId,
        ...(testStepId ? { testStepId } : {}),
        kind: step.kind === "act" ? "action" : "check",
        intent: step.kind === "act" ? step.intent : step.criteria.join(" and "),
        ...savedPathStatus(step),
      });
    }
  }
  if (!steps.length) return undefined;
  const coveredSteps = steps.filter((step) => step.status === "covered").length;
  return {
    totalSteps: steps.length,
    coveredSteps,
    needsModelSteps: steps.length - coveredSteps,
    steps,
  };
}
