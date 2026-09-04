import type { AppMapScenarioTestStep, AppMapTestStepPlacement } from "@relay/protocol";
import { stepKindLabel, type StepEntry } from "../components/test-editor-step";

export function collectStepEntries(steps: readonly AppMapScenarioTestStep[]): StepEntry[] {
  const entries: StepEntry[] = [];
  function visit(
    siblings: readonly AppMapScenarioTestStep[],
    depth: number,
    prefix: string,
    placement?: AppMapTestStepPlacement,
  ) {
    const siblingIds = siblings.map((step) => step.id);
    siblings.forEach((step, index) => {
      const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      entries.push({ step, depth, number, placement, siblingIds, index });
      if (step.kind === "decision") {
        visit(step.thenSteps, depth + 1, number, { parentStepId: step.id, branch: "then" });
        if (step.elseSteps?.length)
          visit(step.elseSteps, depth + 1, `${number}b`, { parentStepId: step.id, branch: "else" });
      } else if (step.kind === "loop") {
        visit(step.steps, depth + 1, number, { parentStepId: step.id, branch: "steps" });
      }
    });
  }
  visit(steps, 0, "");
  return entries;
}

export { stepKindLabel };

export function branchLabel(placement: AppMapTestStepPlacement): string {
  if (placement.branch === "then") return "Then branch";
  if (placement.branch === "else") return "Else branch";
  if (placement.branch === "steps") return "Repeated steps";
  return "Main path";
}
