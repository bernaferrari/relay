import type { AppMap, AppMapScenarioTest, AppMapScenarioTestStep } from "@relay/protocol";

function connectionIdsFromSteps(steps: readonly AppMapScenarioTestStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.binding.status === "resolved" && step.binding.kind === "connections") {
      ids.push(...step.binding.connectionIds);
    }
    if (step.kind === "decision") {
      ids.push(...connectionIdsFromSteps(step.thenSteps));
      if (step.elseSteps) ids.push(...connectionIdsFromSteps(step.elseSteps));
    }
    if (step.kind === "loop") ids.push(...connectionIdsFromSteps(step.steps));
  }
  return ids;
}

function variantHasOriginEvidence(
  variant: AppMap["screenVariants"][string] | undefined,
): boolean {
  return Boolean(variant?.observation || variant?.rawAccessibilityTree);
}

/** Bound origin with no recorded variant cannot be Ready. Dest-end wait-for
 * still compiles; product status stays Unbound until a variant exists. */
export function scenarioTestOriginMissingEvidence(
  map: Pick<AppMap, "screens" | "screenVariants" | "connections">,
  test: Pick<AppMapScenarioTest, "steps">,
): { screenId: string; title: string } | undefined {
  for (const connectionId of connectionIdsFromSteps(test.steps)) {
    const connection = map.connections[connectionId];
    if (!connection) continue;
    const screen = map.screens[connection.fromScreenId];
    if (!screen) continue;
    const variantIds = screen.variantIds ?? [];
    if (!variantIds.length || !variantIds.some((id) => variantHasOriginEvidence(map.screenVariants[id]))) {
      return { screenId: screen.id, title: screen.title };
    }
  }
  return undefined;
}
