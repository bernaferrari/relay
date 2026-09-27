import type { AppMapScenarioTestStep, AppMapTestStepPlacement } from "@relay/protocol";
import { type StepEntry } from "../components/test-editor-step";

export type PendingCheckpointDraft = {
  step: Extract<AppMapScenarioTestStep, { kind: "validation" }>;
  placement?: AppMapTestStepPlacement;
  index: number;
};

function containsStepId(steps: readonly AppMapScenarioTestStep[], stepId: string): boolean {
  return steps.some((step) => {
    if (step.id === stepId) return true;
    if (step.kind === "decision") {
      return containsStepId(step.thenSteps, stepId) || containsStepId(step.elseSteps ?? [], stepId);
    }
    if (step.kind === "loop") return containsStepId(step.steps, stepId);
    return false;
  });
}

/** Local-only insert. An unbound Prove the result must not land on the saved Test. */
export function insertPendingCheckpoint(
  steps: readonly AppMapScenarioTestStep[],
  pending: PendingCheckpointDraft,
): AppMapScenarioTestStep[] {
  if (containsStepId(steps, pending.step.id)) return [...steps];
  const parentId = pending.placement?.parentStepId;
  const branch = pending.placement?.branch;
  if (!parentId) {
    const next = [...steps];
    next.splice(pending.index, 0, pending.step);
    return next;
  }
  return steps.map((step) => insertPendingInto(step, pending, parentId, branch));
}

function insertPendingInto(
  step: AppMapScenarioTestStep,
  pending: PendingCheckpointDraft,
  parentId: string,
  branch: AppMapTestStepPlacement["branch"],
): AppMapScenarioTestStep {
  if (step.id === parentId) {
    if (step.kind === "decision" && branch === "then") {
      const thenSteps = [...step.thenSteps];
      thenSteps.splice(pending.index, 0, pending.step);
      return { ...step, thenSteps };
    }
    if (step.kind === "decision" && branch === "else") {
      const elseSteps = [...(step.elseSteps ?? [])];
      elseSteps.splice(pending.index, 0, pending.step);
      return { ...step, elseSteps };
    }
    if (step.kind === "loop" && branch === "steps") {
      const children = [...step.steps];
      children.splice(pending.index, 0, pending.step);
      return { ...step, steps: children };
    }
    return step;
  }
  if (step.kind === "decision") {
    return {
      ...step,
      thenSteps: step.thenSteps.map((child) => insertPendingInto(child, pending, parentId, branch)),
      ...(step.elseSteps
        ? {
            elseSteps: step.elseSteps.map((child) =>
              insertPendingInto(child, pending, parentId, branch),
            ),
          }
        : {}),
    };
  }
  if (step.kind === "loop") {
    return {
      ...step,
      steps: step.steps.map((child) => insertPendingInto(child, pending, parentId, branch)),
    };
  }
  return step;
}

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

export { stepKindLabel, stepReadinessLabel } from "../components/test-editor-step";

export function branchLabel(placement: AppMapTestStepPlacement): string {
  if (placement.branch === "then") return "Then branch";
  if (placement.branch === "else") return "Else branch";
  if (placement.branch === "steps") return "Repeated steps";
  return "Main path";
}
