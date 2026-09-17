import type {
  ActionSpec,
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  RecipeStep,
} from "@relay/protocol";
import { recipeStepPlatformBlocker } from "@relay/protocol";
import type { PlanPlatform } from "./test-route-platforms.js";

function actionRecipeSteps(action: ActionSpec): readonly RecipeStep[] {
  return action.kind === "steps" || action.kind === "recorded" ? action.steps : [];
}

function recipeStepsFromTestStep(
  step: AppMapScenarioTestStep,
  map: Pick<AppMap, "connections">,
): readonly RecipeStep[] {
  if (step.binding.status !== "resolved") return [];
  if (step.kind === "validation" && step.binding.kind === "recipe-step") {
    return [step.binding.step];
  }
  if (step.kind !== "instruction" || step.binding.kind !== "connections") return [];
  return step.binding.connectionIds.flatMap((connectionId) => {
    const connection = map.connections[connectionId];
    if (!connection) return [];
    return connection.actions.flatMap(actionRecipeSteps);
  });
}

function visitTestSteps(
  steps: readonly AppMapScenarioTestStep[],
  visit: (step: AppMapScenarioTestStep) => void,
): void {
  for (const step of steps) {
    visit(step);
    if (step.kind === "decision") {
      visitTestSteps(step.thenSteps, visit);
      if (step.elseSteps) visitTestSteps(step.elseSteps, visit);
    }
    if (step.kind === "loop") visitTestSteps(step.steps, visit);
  }
}

export function recordedTestStepPlatformBlocker(
  step: AppMapScenarioTestStep,
  map: Pick<AppMap, "connections">,
  recordedPlatforms: readonly PlanPlatform[],
): string | undefined {
  if (!recordedPlatforms.length) return undefined;
  const recipeSteps = recipeStepsFromTestStep(step, map);
  const reasons = recordedPlatforms.map((platform) => {
    for (const recipe of recipeSteps) {
      const reason = recipeStepPlatformBlocker(recipe, platform);
      if (reason) return reason;
    }
    return undefined;
  });
  if (reasons.every(Boolean) && new Set(reasons).size === 1) return reasons[0];
  return undefined;
}

/** First compile-block on this platform. Unrecorded platforms ignore this. */
export function recordedRoutePlatformBlocker(
  test: Pick<AppMapScenarioTest, "steps">,
  map: Pick<AppMap, "connections">,
  platform: PlanPlatform,
): string | undefined {
  let first: string | undefined;
  visitTestSteps(test.steps, (step) => {
    if (first) return;
    const reason = recordedTestStepPlatformBlocker(step, map, [platform]);
    if (reason) first = reason;
  });
  return first;
}

export function testStepPlatformBlockers(
  test: Pick<AppMapScenarioTest, "steps">,
  map: Pick<AppMap, "connections">,
  recordedPlatforms: readonly PlanPlatform[],
): Record<string, string> {
  const blockers: Record<string, string> = {};
  visitTestSteps(test.steps, (step) => {
    const reason = recordedTestStepPlatformBlocker(step, map, recordedPlatforms);
    if (reason) blockers[step.id] = reason;
  });
  return blockers;
}
