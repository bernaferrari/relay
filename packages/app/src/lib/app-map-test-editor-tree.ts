import type { AppMapScenarioTestStep } from "@relay/protocol";

export type ScenarioStepBranch = "root" | "then" | "else" | "loop";

export type ScenarioStepOutlineItem = {
  step: AppMapScenarioTestStep;
  depth: number;
  branch: ScenarioStepBranch;
  index: number;
  siblingCount: number;
  parentStepId?: string;
};

function nestedLists(step: AppMapScenarioTestStep): AppMapScenarioTestStep[][] {
  if (step.kind === "decision") return [step.thenSteps, step.elseSteps ?? []];
  if (step.kind === "loop") return [step.steps];
  return [];
}

export function findScenarioStep(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string | undefined,
): AppMapScenarioTestStep | undefined {
  if (!stepId) return undefined;
  for (const step of steps) {
    if (step.id === stepId) return step;
    for (const children of nestedLists(step)) {
      const match = findScenarioStep(children, stepId);
      if (match) return match;
    }
  }
  return undefined;
}

export function flattenScenarioSteps(
  steps: readonly AppMapScenarioTestStep[],
): ScenarioStepOutlineItem[] {
  const items: ScenarioStepOutlineItem[] = [];
  const visit = (
    siblings: readonly AppMapScenarioTestStep[],
    depth: number,
    branch: ScenarioStepBranch,
    parentStepId?: string,
  ) => {
    siblings.forEach((step, index) => {
      items.push({ step, depth, branch, index, siblingCount: siblings.length, parentStepId });
      if (step.kind === "decision") {
        visit(step.thenSteps, depth + 1, "then", step.id);
        visit(step.elseSteps ?? [], depth + 1, "else", step.id);
      } else if (step.kind === "loop") {
        visit(step.steps, depth + 1, "loop", step.id);
      }
    });
  };
  visit(steps, 0, "root");
  return items;
}

function mapSiblingList(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
  transform: (siblings: AppMapScenarioTestStep[], index: number) => AppMapScenarioTestStep[],
): { steps: AppMapScenarioTestStep[]; changed: boolean } {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index >= 0) {
    return {
      steps: transform(
        steps.map((step) => structuredClone(step)),
        index,
      ),
      changed: true,
    };
  }
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const copy = structuredClone(step);
    if (copy.kind === "decision") {
      const thenResult = mapSiblingList(copy.thenSteps, stepId, transform);
      if (thenResult.changed) {
        copy.thenSteps = thenResult.steps;
        const next = steps.map((item) => structuredClone(item));
        next[index] = copy;
        return { steps: next, changed: true };
      }
      const elseResult = mapSiblingList(copy.elseSteps ?? [], stepId, transform);
      if (elseResult.changed) {
        copy.elseSteps = elseResult.steps;
        const next = steps.map((item) => structuredClone(item));
        next[index] = copy;
        return { steps: next, changed: true };
      }
    } else if (copy.kind === "loop") {
      const bodyResult = mapSiblingList(copy.steps, stepId, transform);
      if (bodyResult.changed) {
        copy.steps = bodyResult.steps;
        const next = steps.map((item) => structuredClone(item));
        next[index] = copy;
        return { steps: next, changed: true };
      }
    }
  }
  return { steps: [...steps], changed: false };
}

export function updateScenarioStepTree(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
  update: (step: AppMapScenarioTestStep) => AppMapScenarioTestStep,
): AppMapScenarioTestStep[] {
  return mapSiblingList(steps, stepId, (siblings, index) => {
    siblings[index] = update(structuredClone(siblings[index]!));
    return siblings;
  }).steps;
}

export function moveScenarioStepTree(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
  direction: -1 | 1,
): AppMapScenarioTestStep[] {
  return mapSiblingList(steps, stepId, (siblings, index) => {
    const destination = index + direction;
    if (destination < 0 || destination >= siblings.length) return siblings;
    [siblings[index], siblings[destination]] = [siblings[destination]!, siblings[index]!];
    return siblings;
  }).steps;
}

function renewIds(step: AppMapScenarioTestStep, makeId: () => string): AppMapScenarioTestStep {
  const copy = { ...structuredClone(step), id: makeId() };
  if (copy.kind === "decision") {
    copy.thenSteps = copy.thenSteps.map((child) => renewIds(child, makeId));
    if (copy.elseSteps) copy.elseSteps = copy.elseSteps.map((child) => renewIds(child, makeId));
  } else if (copy.kind === "loop") {
    copy.steps = copy.steps.map((child) => renewIds(child, makeId));
  }
  return copy;
}

export function duplicateScenarioStepTree(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
  makeId: () => string = () => crypto.randomUUID(),
): AppMapScenarioTestStep[] {
  return mapSiblingList(steps, stepId, (siblings, index) => {
    siblings.splice(index + 1, 0, renewIds(siblings[index]!, makeId));
    return siblings;
  }).steps;
}

export function deleteScenarioStepTree(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
): AppMapScenarioTestStep[] {
  return mapSiblingList(steps, stepId, (siblings, index) => {
    siblings.splice(index, 1);
    return siblings;
  }).steps;
}

export function siblingFocusAfterDelete(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string,
): string | undefined {
  const outline = flattenScenarioSteps(steps);
  const item = outline.find((candidate) => candidate.step.id === stepId);
  if (!item) return undefined;
  const siblings = outline.filter(
    (candidate) => candidate.parentStepId === item.parentStepId && candidate.branch === item.branch,
  );
  return (
    siblings[item.index + 1]?.step.id ?? siblings[item.index - 1]?.step.id ?? item.parentStepId
  );
}

export function addScenarioChild(
  steps: readonly AppMapScenarioTestStep[],
  parentStepId: string,
  branch: Exclude<ScenarioStepBranch, "root">,
  child: AppMapScenarioTestStep,
): AppMapScenarioTestStep[] {
  return updateScenarioStepTree(steps, parentStepId, (parent) => {
    if (parent.kind === "decision" && branch === "then") {
      return { ...parent, thenSteps: [...parent.thenSteps, child] };
    }
    if (parent.kind === "decision" && branch === "else") {
      return { ...parent, elseSteps: [...(parent.elseSteps ?? []), child] };
    }
    if (parent.kind === "loop" && branch === "loop") {
      return { ...parent, steps: [...parent.steps, child] };
    }
    return parent;
  });
}
