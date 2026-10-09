import type { AppMap, AppMapScenarioTestStep, ActionSpec } from "@relay/protocol";

export type ProductTestTextAction = {
  key: string;
  connectionId: string;
  actionId: string;
  recipeStepId?: string;
  text: string;
  sharedTestNames: readonly string[];
};

function instructions(
  steps: readonly AppMapScenarioTestStep[],
  activeOnly = false,
): AppMapScenarioTestStep[] {
  return steps.flatMap((step) => {
    if (activeOnly && step.execution?.status === "disabled") return [];
    const children =
      step.kind === "decision"
        ? [
            ...instructions(step.thenSteps, activeOnly),
            ...instructions(step.elseSteps ?? [], activeOnly),
          ]
        : step.kind === "loop"
          ? instructions(step.steps, activeOnly)
          : [];
    return [step, ...children];
  });
}

/** Read-only action addresses for the selected saved instruction. */
export function testTextActions(map: AppMap, testId: string) {
  const result: Record<string, ProductTestTextAction[]> = {};
  const test = map.tests[testId];
  if (!test) return result;
  for (const step of instructions(test.steps, true)) {
    if (step.binding.status !== "resolved" || step.binding.kind !== "connections") continue;
    result[step.id] = step.binding.connectionIds.flatMap((connectionId) => {
      const sharedTestNames = Object.values(map.tests)
        .filter(
          (other) =>
            other.id !== testId &&
            instructions(other.steps).some(
              (candidate) =>
                candidate.binding.status === "resolved" &&
                candidate.binding.kind === "connections" &&
                candidate.binding.connectionIds.includes(connectionId),
            ),
        )
        .map((other) => other.name);
      return (map.connections[connectionId]?.actions ?? []).flatMap((action) => {
        const address = { connectionId, actionId: action.id, sharedTestNames };
        if (action.kind === "text")
          return [
            { ...address, key: JSON.stringify([connectionId, action.id]), text: action.text },
          ];
        if (action.kind !== "recorded" && action.kind !== "steps") return [];
        return action.steps.flatMap((recipeStep) =>
          recipeStep.kind === "type" && recipeStep.id
            ? [
                {
                  ...address,
                  key: JSON.stringify([connectionId, action.id, recipeStep.id]),
                  recipeStepId: recipeStep.id,
                  text: recipeStep.text,
                },
              ]
            : [],
        );
      });
    });
  }
  return result;
}

/** Replace a single addressed text leaf; every captured field stays canonical. */
export function replaceActionText(
  actions: readonly ActionSpec[],
  address: ProductTestTextAction,
  text: string,
): ActionSpec[] {
  const next = structuredClone([...actions]);
  const action = next.find((item) => item.id === address.actionId);
  if (action?.kind === "text" && !address.recipeStepId) action.text = text;
  else if ((action?.kind === "recorded" || action?.kind === "steps") && address.recipeStepId) {
    const step = action.steps.find((item) => item.id === address.recipeStepId);
    if (!step || step.kind !== "type")
      throw new TypeError("This text action changed. Reload the test.");
    step.text = text;
  } else throw new TypeError("This text action changed. Reload the test.");
  return next;
}

export function textParameterNames(text: string): string[] {
  return [
    ...new Set([...text.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/gu)].map((match) => match[1]!)),
  ];
}
