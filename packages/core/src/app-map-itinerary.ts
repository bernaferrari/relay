import type {
  ActionSpec,
  AppMap,
  AppMapCompiledFlow,
  Connection,
  RecipeStep,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { compileAppMapConnection, screenExpectation } from "./app-map-compiler.js";

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

type ReviewedReturnPlan =
  | {
      status: "complete";
      steps: RecipeStep[];
      recipes: Record<string, Recipe>;
      verifiedScreenId?: string;
    }
  | {
      status: "missing";
      steps: RecipeStep[];
      recipes: Record<string, Recipe>;
      connectionId?: string;
      currentScreenId?: string;
    };

/** Explicit ready connections are the canonical Figma-style inverse edge.
 * They stay independently replayable and visible in the graph data while the
 * planner embeds only a compact module reference in the next sibling. An
 * inverse is a graph relationship, not a particular Android gesture: a
 * reviewed modal dismissal may be OK or Cancel while a page commonly uses
 * Back. The compiled connection proves both endpoints around the authored
 * action, so guessing from the action shape would discard valid state-machine
 * edges without adding safety. */
type ScreenConnection = Connection & { destination: { kind: "screen"; screenId: string } };

type AncestorInverse =
  | { status: "resolved"; connection: ScreenConnection; destinationIndex: number }
  | { status: "absent" | "ambiguous" };

function explicitReviewedConnection(
  map: AppMap,
  fromScreenId: string,
  destinationScreenId: string,
): ScreenConnection | undefined | null {
  const candidates = Object.values(map.connections).filter(
    (candidate): candidate is ScreenConnection =>
      candidate.state === "ready" &&
      candidate.fromScreenId === fromScreenId &&
      candidate.destination.kind === "screen" &&
      candidate.destination.screenId === destinationScreenId,
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1) return null;
  return candidates[0]!;
}

function compileReviewedConnection(
  map: AppMap,
  connection: ScreenConnection,
): { step: RecipeStep; recipes: Record<string, Recipe> } {
  const compiled = compileAppMapConnection(map, connection.id);
  const recipes: Record<string, Recipe> = {};
  for (const recipe of Object.values(compiled.recipes)) {
    recipes[recipe.id] = {
      id: recipe.id,
      title: recipe.title,
      ...(recipe.description ? { description: recipe.description } : {}),
      source: "custom",
      steps: structuredClone(recipe.steps),
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    };
  }
  return {
    step: {
      kind: "module",
      id: `relay-return-edge-${connection.id}`,
      recipeId: compiled.rootRecipeId,
    },
    recipes,
  };
}

function explicitReviewedAncestorInverse(
  map: AppMap,
  currentScreenId: string,
  pathScreens: Array<string | undefined>,
  targetIndex: number,
  currentIndex: number,
): AncestorInverse {
  const candidates = Object.values(map.connections).filter(
    (candidate): candidate is ScreenConnection =>
      candidate.state === "ready" &&
      candidate.fromScreenId === currentScreenId &&
      candidate.destination.kind === "screen" &&
      pathScreens.slice(targetIndex, currentIndex).includes(candidate.destination.screenId),
  );
  if (candidates.length === 0) return { status: "absent" };
  if (candidates.length !== 1) return { status: "ambiguous" };
  const connection = candidates[0]!;
  // When a path revisits the same logical screen, consume through its earliest
  // still-required occurrence. The frozen destination proof makes this jump
  // safe; using the later occurrence would only replay redundant edges.
  const destinationIndex = pathScreens
    .slice(targetIndex, currentIndex)
    .findIndex((screenId) => screenId === connection.destination.screenId);
  return {
    status: "resolved",
    connection,
    destinationIndex: targetIndex + destinationIndex,
  };
}

function reviewedReturnPlan(
  map: AppMap,
  previousPlan: AppMapCompiledFlow | undefined,
  currentScreenId: string | undefined,
  targetScreenId: string | undefined,
): ReviewedReturnPlan {
  if (!previousPlan || !currentScreenId || !targetScreenId) {
    return {
      status: "missing",
      steps: [],
      recipes: {},
      ...(currentScreenId ? { currentScreenId } : {}),
    };
  }
  const pathScreens = [
    previousPlan.flow.startScreenId,
    ...previousPlan.connections.map((connection) =>
      connection.destination.kind === "screen" ? connection.destination.screenId : undefined,
    ),
  ];
  let current = -1;
  for (let index = pathScreens.length - 1; index >= 0; index -= 1) {
    if (pathScreens[index] === currentScreenId) {
      current = index;
      break;
    }
  }
  let target = -1;
  for (let index = current - 1; index >= 0; index -= 1) {
    if (pathScreens[index] === targetScreenId) {
      target = index;
      break;
    }
  }
  if (current < 0) {
    return { status: "missing", steps: [], recipes: {}, currentScreenId };
  }
  if (target < 0) {
    // A scenario step may intentionally begin below the shared root (for
    // example Kids Off -> Enabled -> PIN -> Enabled -> Kids Off). Its next
    // sibling can still have a reviewed direct edge back to that root even
    // though the root is not part of the immediately previous local path.
    const direct = explicitReviewedConnection(map, currentScreenId, targetScreenId);
    if (!direct) {
      return { status: "missing", steps: [], recipes: {}, currentScreenId };
    }
    const compiled = compileReviewedConnection(map, direct);
    return {
      status: "complete",
      steps: [compiled.step],
      recipes: compiled.recipes,
      verifiedScreenId: targetScreenId,
    };
  }
  if (current <= target) {
    return { status: "missing", steps: [], recipes: {}, currentScreenId };
  }
  const steps: RecipeStep[] = [];
  const recipes: Record<string, Recipe> = {};
  let verifiedScreenId: string | undefined;
  let cursor = current;
  while (cursor > target) {
    const cursorScreenId = pathScreens[cursor];
    const compiled = previousPlan.connections[cursor - 1];
    if (!cursorScreenId || !compiled) {
      return {
        status: "missing",
        steps,
        recipes,
        connectionId: compiled?.connectionId,
        currentScreenId: cursorScreenId ?? currentScreenId,
      };
    }
    const connection = map.connections[compiled.connectionId];
    if (!connection) {
      return {
        status: "missing",
        steps,
        recipes,
        connectionId: compiled.connectionId,
        currentScreenId: cursorScreenId,
      };
    }
    const ancestorInverse = explicitReviewedAncestorInverse(
      map,
      cursorScreenId,
      pathScreens,
      target,
      cursor,
    );
    if (ancestorInverse.status === "ambiguous") {
      return {
        status: "missing",
        steps,
        recipes,
        connectionId: connection.id,
        currentScreenId: cursorScreenId,
      };
    }
    if (ancestorInverse.status === "resolved") {
      const inverse = ancestorInverse.connection;
      const reviewed = compileReviewedConnection(map, inverse);
      Object.assign(recipes, reviewed.recipes);
      steps.push(reviewed.step);
      verifiedScreenId = inverse.destination.screenId;
      cursor = ancestorInverse.destinationIndex;
      continue;
    }
    // Scroll variants are one logical surface. Reaching the parent hierarchy
    // does not require Back; the next semantic reveal owns viewport placement.
    if (connection.actions.length > 0 && connection.actions.every(isScrollAction)) {
      cursor -= 1;
      continue;
    }
    const reviewedReturn = connection.return;
    const origin = map.screens[connection.fromScreenId];
    if (!origin?.identity) {
      return { status: "missing", steps, recipes, connectionId: connection.id, currentScreenId };
    }
    // Returning is a graph mutation, not a platform assumption. Even a
    // conventional Android child can override Back, open a dialog, or jump
    // over multiple logical parents. Only an authored return contract may
    // mutate the device here.
    if (!reviewedReturn) {
      return {
        status: "missing",
        steps,
        recipes,
        connectionId: connection.id,
        currentScreenId: cursorScreenId,
      };
    }
    const currentScreen = map.screens[cursorScreenId];
    if (!currentScreen?.identity) {
      return {
        status: "missing",
        steps,
        recipes,
        connectionId: connection.id,
        currentScreenId: cursorScreenId,
      };
    }
    const sourceExpectation = screenExpectation(
      map,
      currentScreen,
      `relay-return-source-${connection.id}`,
    );
    const expectation = screenExpectation(
      map,
      { ...origin, identity: structuredClone(reviewedReturn.expectedDestination.identity) },
      `relay-return-proof-${connection.id}`,
    );
    steps.push(
      sourceExpectation,
      { kind: "key", key: "back", id: `relay-return-${connection.id}` },
      {
        ...expectation,
        ...(reviewedReturn.expectedApp ? { expectedApp: reviewedReturn.expectedApp } : {}),
      },
    );
    verifiedScreenId = connection.fromScreenId;
    cursor -= 1;
  }
  return {
    status: "complete",
    steps,
    recipes,
    ...(verifiedScreenId ? { verifiedScreenId } : {}),
  };
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

/** Trim a cold path to the nearest proven shared checkpoint. Every hierarchy
 * mutation is an authored inverse edge followed immediately by its frozen
 * destination proof. Missing proof stops on the current screen; it never
 * guesses with generic Back or reopens a root path. */
export function warmCompiledFlowGraphFromSharedPrefix(
  map: AppMap,
  graph: Record<string, Recipe>,
  plan: AppMapCompiledFlow,
  previousPlan?: AppMapCompiledFlow,
  currentScreenId?: string,
): Record<string, Recipe> {
  const root = graph[plan.rootRecipeId];
  if (!root) return graph;
  const sourceIndex = root.steps.findIndex(
    (step) => step.kind === "expect-screen" && step.id === `relay-source-${plan.flow.id}`,
  );
  if (sourceIndex < 0) return graph;
  // The preceding destination assertion is the live proof for this exact
  // source, and nothing executes between sibling modules. Carry it forward
  // instead of taking the same tree and screenshot again.
  if (currentScreenId === plan.flow.startScreenId) {
    return {
      ...graph,
      [plan.rootRecipeId]: {
        ...root,
        title: root.title.replace(/cold start/iu, "verified checkpoint"),
        steps: root.steps.slice(sourceIndex + 1),
      },
    };
  }
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
  if (currentScreenId) {
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
  const returns = reviewedReturnPlan(map, previousPlan, currentScreenId, sharedScreenId);
  const missingReturnId =
    returns.status === "missing"
      ? `relay-return-required-${returns.connectionId ?? `${returns.currentScreenId ?? "unknown"}-to-${sharedScreenId}`}`
      : undefined;
  const missingReturnConnection =
    returns.status === "missing" && returns.connectionId
      ? map.connections[returns.connectionId]
      : undefined;
  const recoverySteps = returns.steps;
  const alreadyVerifiedTarget =
    returns.status === "complete" && returns.verifiedScreenId === sharedScreenId;
  return {
    ...graph,
    ...returns.recipes,
    [plan.rootRecipeId]: {
      ...root,
      title: root.title.replace(
        /cold start/iu,
        returns.status === "complete" ? "reviewed return" : "return proof required",
      ),
      steps: [
        ...recoverySteps,
        ...(alreadyVerifiedTarget
          ? []
          : [
              {
                ...structuredClone(warmExpectation),
                id:
                  missingReturnId ??
                  `${warmExpectation.id ?? `relay-source-${sharedScreenId}`}:warm`,
                ...(missingReturnId
                  ? {
                      timeoutMs: 0,
                      note: `Reviewed return contract required before leaving ${currentScreenId ?? "the current screen"}`,
                      ...(missingReturnConnection?.destination.kind === "screen"
                        ? {
                            returnRequirement: {
                              connectionId: missingReturnConnection.id,
                              fromScreenId: missingReturnConnection.fromScreenId,
                              destinationScreenId: missingReturnConnection.destination.screenId,
                            },
                          }
                        : {}),
                    }
                  : {}),
              },
            ]),
        ...root.steps.slice(suffixStart),
      ],
    },
  };
}
