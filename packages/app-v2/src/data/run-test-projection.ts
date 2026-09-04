import type { AppMapScenarioTestStep } from "@relay/protocol";
import type { ProductTestStep } from "@relay/product/catalog";

export type ProductTestSummary = {
  id: string;
  name: string;
  appMapId: string;
  appName: string;
  stepCount: number;
  steps?: readonly ProductTestStep[];
};

/** Projects authored Test steps into the bounded Run service vocabulary. */
export function projectTestStep(step: AppMapScenarioTestStep): ProductTestStep {
  const children =
    step.kind === "decision"
      ? [...step.thenSteps, ...(step.elseSteps ?? [])]
      : step.kind === "loop"
        ? step.steps
        : [];
  const needsReview =
    step.execution?.status === "disabled" ||
    step.binding.status === "unresolved" ||
    children.some(
      (child) => child.execution?.status === "disabled" || child.binding.status === "unresolved",
    );
  return {
    id: step.id,
    kind: step.kind,
    intent: step.intent,
    ...(step.note ? { note: step.note } : {}),
    capture: step.capture === true,
    status: needsReview ? "needs-review" : "ready",
    ...(children.length ? { children: children.map(projectTestStep) } : {}),
  };
}
