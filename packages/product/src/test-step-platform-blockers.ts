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
  if (step.kind !== "instruction" || step.binding.status !== "resolved") return [];
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
