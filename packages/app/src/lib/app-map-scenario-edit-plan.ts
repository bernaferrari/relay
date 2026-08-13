import type {
  AppMapScenarioTest,
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestStepPlacement,
} from "@relay/protocol";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function childLists(
  step: AppMapScenarioTestStep,
): Array<{ placement: AppMapTestStepPlacement; steps: AppMapScenarioTestStep[] }> {
  if (step.kind === "decision") {
    return [
      { placement: { parentStepId: step.id, branch: "then" }, steps: step.thenSteps },
      { placement: { parentStepId: step.id, branch: "else" }, steps: step.elseSteps ?? [] },
    ];
  }
  return step.kind === "loop"
    ? [{ placement: { parentStepId: step.id, branch: "steps" }, steps: step.steps }]
    : [];
}

function planSiblingEdits(
  previous: AppMapScenarioTestStep[],
  next: AppMapScenarioTestStep[],
  placement: AppMapTestStepPlacement,
  edits: AppMapScenarioTestEdit[],
): void {
  const previousById = new Map(previous.map((step) => [step.id, step]));
  const nextById = new Map(next.map((step) => [step.id, step]));

  for (const step of previous) {
    if (!nextById.has(step.id)) edits.push({ kind: "step.remove", stepId: step.id });
  }
  for (const [index, step] of next.entries()) {
    if (!previousById.has(step.id)) {
      edits.push({ kind: "step.add", step: structuredClone(step), placement, index });
    }
  }

  for (const step of next) {
    const prior = previousById.get(step.id);
    if (!prior) continue;
    if (prior.kind !== step.kind) {
      throw new Error(`Test step ${step.id} changed kind; remove and add it with a new stable id`);
    }
    const patch: Extract<AppMapScenarioTestEdit, { kind: "step.patch" }>["patch"] = {};
    if (prior.intent !== step.intent) patch.intent = step.intent;
    if (prior.note !== step.note) patch.note = step.note ?? null;
    if (!same(prior.binding, step.binding)) patch.binding = structuredClone(step.binding);
    if (Object.keys(patch).length) edits.push({ kind: "step.patch", stepId: step.id, patch });

    const beforeChildren = childLists(prior);
    for (const child of childLists(step)) {
      const before = beforeChildren.find(
        ({ placement: candidate }) =>
          candidate.parentStepId === child.placement.parentStepId &&
          candidate.branch === child.placement.branch,
      );
      planSiblingEdits(before?.steps ?? [], child.steps, child.placement, edits);
    }
  }

  const orderedStepIds = next.map(({ id }) => id);
  const survivingPreviousOrder = previous.map(({ id }) => id).filter((id) => nextById.has(id));
  const addedIds = new Set(next.filter((step) => !previousById.has(step.id)).map(({ id }) => id));
  const orderBeforeReorder = [...survivingPreviousOrder];
  for (const [index, id] of orderedStepIds.entries()) {
    if (addedIds.has(id)) orderBeforeReorder.splice(index, 0, id);
  }
  if (!same(orderBeforeReorder, orderedStepIds)) {
    edits.push({ kind: "step.reorder", orderedStepIds, placement });
  }
}

/** Turn one local editor transition into semantic stable-ID operations.
 * Persistence timestamps and revisions remain server-owned. */
export function planScenarioTestEdits(
  previous: AppMapScenarioTest,
  next: AppMapScenarioTest,
): AppMapScenarioTestEdit[] {
  if (previous.id !== next.id) throw new Error("A Test edit cannot change test identity");
  const edits: AppMapScenarioTestEdit[] = [];
  if (previous.name !== next.name || !same(previous.capture, next.capture)) {
    edits.push({
      kind: "test.patch",
      patch: {
        ...(previous.name !== next.name ? { name: next.name } : {}),
        ...(!same(previous.capture, next.capture)
          ? { capture: next.capture ? structuredClone(next.capture) : null }
          : {}),
      },
    });
  }
  planSiblingEdits(previous.steps, next.steps, {}, edits);
  return edits;
}
