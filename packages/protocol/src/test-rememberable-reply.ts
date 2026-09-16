import type { ActionSpec, AppMap } from "./app-map.js";
import type { RecipeStep } from "./recipes.js";
import type { AppMapScenarioTest, AppMapScenarioTestStep } from "./test-intent.js";

function walkTestSteps(steps: readonly AppMapScenarioTestStep[]): AppMapScenarioTestStep[] {
  const out: AppMapScenarioTestStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.kind === "decision") {
      out.push(...walkTestSteps(step.thenSteps), ...walkTestSteps(step.elseSteps ?? []));
    }
    if (step.kind === "loop") out.push(...walkTestSteps(step.steps));
  }
  return out;
}

function recipeHasRememberableReply(step: RecipeStep): boolean {
  return (
    step.kind === "extract" || step.kind === "wait-response" || step.kind === "evaluate-semantic"
  );
}

function actionHasRememberableReply(action: ActionSpec): boolean {
  if ("steps" in action && Array.isArray(action.steps)) {
    return action.steps.some(recipeHasRememberableReply);
  }
  return action.kind === "assertion" && action.assertion.kind === "semantic";
}

function bindingHasRememberableReply(step: AppMapScenarioTestStep): boolean {
  if (step.kind === "extraction") return true;
  const binding = step.binding;
  if (binding.status !== "resolved") return false;
  if (binding.kind === "assertion") return binding.assertion.kind === "semantic";
  if (binding.kind === "recipe-step") {
    const kind = binding.step.kind;
    return kind === "extract" || kind === "wait-response" || kind === "evaluate-semantic";
  }
  return false;
}

/** True when a Test already captures or judges a reply — not visual chrome. */
export function testHasRememberableReply(
  test: Pick<AppMapScenarioTest, "steps">,
  map?: Pick<AppMap, "connections">,
): boolean {
  for (const step of walkTestSteps(test.steps)) {
    if (bindingHasRememberableReply(step)) return true;
    if (step.binding.status !== "resolved" || step.binding.kind !== "connections" || !map) {
      continue;
    }
    for (const id of step.binding.connectionIds) {
      const connection = map.connections[id];
      if (connection?.actions.some(actionHasRememberableReply)) return true;
    }
  }
  return false;
}
