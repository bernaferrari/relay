import type {
  ActionSpec,
  AppMap,
  AppMapCompiledFlow,
  Connection,
  RecipeStep,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";

function authoredSteps(action: ActionSpec): RecipeStep[] {
  return action.kind === "recorded" || action.kind === "steps" ? action.steps : [];
}

function isVerticalSwipe(
  swipe:
    | Extract<RecipeStep, { kind: "swipe" }>
    | Extract<ActionSpec, { kind: "gesture" }>["gesture"],
): boolean {
  if (swipe.kind !== "swipe") return false;
  const horizontalDistance = Math.abs(swipe.to.x - swipe.from.x);
  const verticalDistance = Math.abs(swipe.to.y - swipe.from.y);
  return verticalDistance > 0 && verticalDistance >= horizontalDistance * 1.5;
}

function isScrollAction(action: ActionSpec): boolean {
  if (action.kind === "gesture") {
    return action.gesture.kind === "scroll" || isVerticalSwipe(action.gesture);
  }
  return authoredSteps(action).some(
    (step) => step.kind === "scroll" || (step.kind === "swipe" && isVerticalSwipe(step)),
  );
}

function scrollFamilyScreenIds(map: AppMap, startScreenId: string): Set<string> {
  const family = new Set([startScreenId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const connection of Object.values(map.connections ?? {}) as Connection[]) {
      if (connection.destination.kind !== "screen") continue;
      const isScroll = connection.actions.some(isScrollAction);
      if (!isScroll) continue;
      const destinationId = connection.destination.screenId;
      if (family.has(connection.fromScreenId) && !family.has(destinationId)) {
        family.add(destinationId);
        changed = true;
      } else if (family.has(destinationId) && !family.has(connection.fromScreenId)) {
        family.add(connection.fromScreenId);
        changed = true;
      }
    }
  }
  return family;
}

function scrollFamilyExpectation(
  map: AppMap,
  expectation: Extract<RecipeStep, { kind: "expect-screen" }>,
): Extract<RecipeStep, { kind: "expect-screen" }> {
  const screenIds = scrollFamilyScreenIds(map, expectation.screenId);
  if (screenIds.size === 1) return expectation;
  const aliases = new Set(expectation.aliases ?? []);
  const observations = [...(expectation.observations ?? [])];
  for (const screenId of screenIds) {
    if (screenId === expectation.screenId) continue;
    const screen = map.screens[screenId];
    if (!screen?.identity) continue;
    aliases.add(screen.identity.fingerprint);
    for (const alias of screen.identity.aliases ?? []) aliases.add(alias);
    for (const variantId of screen.variantIds) {
      const observation = map.screenVariants[variantId]?.observation;
      if (observation?.nodes.length) observations.push(structuredClone(observation));
    }
  }
  return {
    ...expectation,
    ...(aliases.size ? { aliases: [...aliases] } : {}),
    ...(observations.length ? { observations } : {}),
  };
}

/** Trim a cold path to the nearest proven shared checkpoint. The resulting
 * source assertion owns bounded Back recovery. It deliberately does not try
 * to restore list position while still inside an unrelated child screen;
 * semantic scroll edges reveal the next control after the checkpoint is
 * reached. */
export function warmCompiledFlowGraphFromSharedPrefix(
  map: AppMap,
  graph: Record<string, Recipe>,
  plan: AppMapCompiledFlow,
  previousPlan?: AppMapCompiledFlow,
  currentScreenId?: string,
  options: { restoreParentViewport?: boolean } = { restoreParentViewport: true },
): Record<string, Recipe> {
  const root = graph[plan.rootRecipeId];
  if (!root) return graph;
  const sharesStart = previousPlan?.flow.startScreenId === plan.flow.startScreenId;
  let sharedConnectionCount = 0;
  if (sharesStart) {
    while (
      sharedConnectionCount < plan.connections.length &&
      sharedConnectionCount < (previousPlan?.connections.length ?? 0) &&
      plan.connections[sharedConnectionCount]?.connectionId ===
        previousPlan?.connections[sharedConnectionCount]?.connectionId
    ) {
      sharedConnectionCount += 1;
    }
  }
  if (currentScreenId === plan.flow.startScreenId) {
    sharedConnectionCount = 0;
  } else if (currentScreenId) {
    const currentConnectionIndex = plan.connections.findIndex(
      (connection) =>
        connection.destination.kind === "screen" &&
        connection.destination.screenId === currentScreenId,
    );
    if (currentConnectionIndex >= 0) sharedConnectionCount = currentConnectionIndex + 1;
  }

  const sharedConnection = plan.connections[sharedConnectionCount - 1];
  const sharedScreenId =
    sharedConnectionCount === 0
      ? plan.flow.startScreenId
      : sharedConnection?.destination.kind === "screen"
        ? sharedConnection.destination.screenId
        : undefined;
  const sourceIndex = root.steps.findIndex(
    (step) => step.kind === "expect-screen" && step.id === `relay-source-${plan.flow.id}`,
  );
  const suffixStart =
    sharedConnectionCount === 0 ? sourceIndex + 1 : sharedConnection?.compiledStepRange[1];
  const terminalExpectation =
    sharedScreenId && suffixStart !== undefined && suffixStart > 0
      ? root.steps
          .slice(0, suffixStart)
          .reverse()
          .find(
            (step): step is Extract<RecipeStep, { kind: "expect-screen" }> =>
              step.kind === "expect-screen" && step.screenId === sharedScreenId,
          )
      : undefined;
  if (sourceIndex < 0 || !terminalExpectation) return graph;

  const warmExpectation = scrollFamilyExpectation(map, terminalExpectation);
  return {
    ...graph,
    [plan.rootRecipeId]: {
      ...root,
      title: root.title.replace(/cold start/iu, "warm recovery"),
      steps: [
        {
          ...structuredClone(warmExpectation),
          id: `${warmExpectation.id ?? `relay-source-${sharedScreenId}`}:warm`,
          recovery: {
            strategy: "back",
            maxAttempts: 8,
            ...(options.restoreParentViewport ? { restoreParentViewport: true } : {}),
          },
        },
        ...root.steps.slice(suffixStart),
      ],
    },
  };
}
