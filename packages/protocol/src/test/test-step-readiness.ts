import type { AppMapScenarioTest, AppMapScenarioTestStep } from "./test-intent.js";

/** True when a step runs from its plain-English words instead of a recording. */
export function stepRunsFromText(step: AppMapScenarioTestStep): boolean {
  return (
    (step.kind === "instruction" || step.kind === "validation") &&
    step.binding.status === "unresolved" &&
    step.binding.fromText === true
  );
}

/** True when every root step runs from its plain-English words: no recorded,
 * scripted, manual, extracted, branching, looping, or disabled step
 * participates. Only then is recorded screen evidence genuinely absent from
 * execution, so a managed target environment can stand in for it. */
export function scenarioTestRunsEntirelyFromText(test: Pick<AppMapScenarioTest, "steps">): boolean {
  return (
    test.steps.length > 0 &&
    test.steps.every((step) => step.execution?.status !== "disabled" && stepRunsFromText(step))
  );
}

/** True when a step blocks its Test from running until someone sets it up. */
export function stepNeedsSetup(step: AppMapScenarioTestStep): boolean {
  if (step.execution?.status === "disabled") return true;
  return step.binding.status === "unresolved" && !stepRunsFromText(step);
}
