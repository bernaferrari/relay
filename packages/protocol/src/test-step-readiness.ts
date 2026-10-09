import type { AppMapScenarioTestStep } from "./test-intent.js";

/** True when a step runs from its plain-English words instead of a recording. */
export function stepRunsFromText(step: AppMapScenarioTestStep): boolean {
  return (
    (step.kind === "instruction" || step.kind === "validation") &&
    step.binding.status === "unresolved" &&
    step.binding.fromText === true
  );
}

/** True when a step blocks its Test from running until someone sets it up. */
export function stepNeedsSetup(step: AppMapScenarioTestStep): boolean {
  if (step.execution?.status === "disabled") return true;
  return step.binding.status === "unresolved" && !stepRunsFromText(step);
}
