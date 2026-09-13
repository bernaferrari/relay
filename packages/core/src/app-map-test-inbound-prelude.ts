import type { AppMap, Connection, RecipeStep } from "@relay/protocol";
import { compileAppMapConnection } from "./app-map-compiler.js";
import { leftoverConversationHomePrelude } from "./leftover-origin-recovery.js";
import type { Recipe } from "./recipes.js";

type MappedPreludeGesture = Extract<RecipeStep, { kind: "tap" | "key" | "swipe" | "scroll" }>;

function isHierarchyDismissConnection(connection: Connection): boolean {
  for (const action of connection.actions) {
    if (action.kind === "back" || action.kind === "home") return true;
    if (
      (action.kind === "recorded" || action.kind === "steps") &&
      action.steps.some(
        (step) => step.kind === "key" && (step.key === "back" || step.key === "home"),
      )
    ) {
      return true;
    }
    if (action.kind === "tap") {
      const label = action.target.label?.trim().toLowerCase();
      if (label === "close" || label === "done" || label === "dismiss") return true;
    }
  }
  return false;
}

function readyInboundConnections(map: AppMap, screenId: string): Connection[] {
  return Object.values(map.connections)
    .filter(
      (connection) =>
        connection.state === "ready" &&
        connection.destination.kind === "screen" &&
        connection.destination.screenId === screenId &&
        !isHierarchyDismissConnection(connection),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Walk reviewed forward edges backward from the first landing. Overlay
 * Close/Back dismissals stay off this path — seek already has a Back rung. */
function inboundConnectionPath(map: AppMap, destinationScreenId: string): Connection[] {
  type Frame = { screenId: string; path: Connection[] };
  const queue: Frame[] = [{ screenId: destinationScreenId, path: [] }];
  const visited = new Set<string>([destinationScreenId]);
  while (queue.length) {
    const current = queue.shift()!;
    const incoming = readyInboundConnections(map, current.screenId).filter(
      (connection) => !visited.has(connection.fromScreenId),
    );
    if (!incoming.length) return current.path;
    for (const connection of incoming) {
      if (current.path.length >= 8) continue;
      visited.add(connection.fromScreenId);
      queue.push({ screenId: connection.fromScreenId, path: [connection, ...current.path] });
    }
  }
  return [];
}

function preludeGestureFromCompiledStep(step: RecipeStep): MappedPreludeGesture | undefined {
  if (step.kind === "tap") {
    return {
      kind: "tap",
      target: structuredClone(step.target),
      ...(step.fallbackTargets?.length
        ? { fallbackTargets: structuredClone(step.fallbackTargets) }
        : {}),
    };
  }
  if (step.kind === "key") return { kind: "key", key: step.key };
  if (step.kind === "swipe") {
    return {
      kind: "swipe",
      from: structuredClone(step.from),
      to: structuredClone(step.to),
      ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
    };
  }
  if (step.kind === "scroll") {
    return {
      kind: "scroll",
      direction: step.direction,
      ...(step.amount === undefined ? {} : { amount: step.amount }),
    };
  }
  return undefined;
}

function samePreludeGesture(left: MappedPreludeGesture, right: MappedPreludeGesture): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "tap" && right.kind === "tap") {
    return (
      (left.target.identifier ?? "") === (right.target.identifier ?? "") &&
      (left.target.label ?? "") === (right.target.label ?? "") &&
      (left.target.text ?? "") === (right.target.text ?? "")
    );
  }
  if (left.kind === "key" && right.kind === "key") return left.key === right.key;
  return false;
}

function compileInboundPrelude(map: AppMap, connections: Connection[]): MappedPreludeGesture[] {
  const steps: MappedPreludeGesture[] = [];
  for (const connection of connections) {
    const compiled = compileAppMapConnection(map, connection.id);
    const recipe = compiled.recipes[compiled.rootRecipeId];
    if (!recipe) continue;
    for (const step of recipe.steps) {
      const gesture = preludeGestureFromCompiledStep(step);
      if (!gesture) continue;
      const previous = steps.at(-1);
      if (previous && samePreludeGesture(previous, gesture)) continue;
      steps.push(gesture);
      if (steps.length >= 16) return steps;
    }
  }
  return steps;
}

function firstSeekableStep(
  graph: Record<string, Recipe>,
  recipeId: string,
  seen = new Set<string>(),
):
  | {
      recipe: Recipe;
      index: number;
      step: Extract<RecipeStep, { kind: "expect-screen" | "tour" }>;
    }
  | undefined {
  if (seen.has(recipeId)) return undefined;
  seen.add(recipeId);
  const recipe = graph[recipeId];
  if (!recipe) return undefined;
  for (const [index, step] of recipe.steps.entries()) {
    if (step.kind === "expect-screen" || step.kind === "tour") {
      return { recipe, index, step };
    }
    if (step.kind === "module") {
      const nested = firstSeekableStep(graph, step.recipeId, seen);
      if (nested) return nested;
    }
  }
  return undefined;
}

function seekDestinationScreenId(
  map: AppMap,
  step: Extract<RecipeStep, { kind: "expect-screen" | "tour" }>,
): string | undefined {
  if (step.kind === "expect-screen") return step.screenId;
  if (step.originScreenId) return step.originScreenId;
  if (step.originFingerprint) {
    return Object.values(map.screens).find(
      (screen) => screen.identity?.fingerprint === step.originFingerprint,
    )?.id;
  }
  if (!step.originTitle) return undefined;
  const matches = Object.values(map.screens).filter((screen) => screen.title === step.originTitle);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

function existingPreludeSteps(
  step: Extract<RecipeStep, { kind: "expect-screen" | "tour" }>,
): MappedPreludeGesture[] | undefined {
  if (step.kind === "tour") return step.preludeSteps;
  return (
    step as Extract<RecipeStep, { kind: "expect-screen" }> & {
      preludeSteps?: MappedPreludeGesture[];
    }
  ).preludeSteps;
}

/** A Test that starts on its destination still has to seek there from home
 * or composer. Recorded inbound edges become conditional prelude, never a
 * per-app hamburger guess. */
export function attachMappedInboundPrelude(
  map: AppMap,
  graph: Record<string, Recipe>,
  rootRecipeId: string,
): void {
  const found = firstSeekableStep(graph, rootRecipeId);
  if (!found || existingPreludeSteps(found.step)?.length) return;
  const screenId = seekDestinationScreenId(map, found.step);
  if (!screenId) return;
  const path = inboundConnectionPath(map, screenId);
  if (path.length) {
    const preludeSteps = compileInboundPrelude(map, path);
    if (preludeSteps.length) {
      const start = map.screens[path[0]!.fromScreenId];
      found.recipe.steps[found.index] = {
        ...found.step,
        preludeSteps,
        ...(start?.identity?.fingerprint
          ? { preludeStartFingerprint: start.identity.fingerprint }
          : {}),
        ...(start?.identity?.aliases?.length
          ? { preludeStartAliases: [...start.identity.aliases] }
          : {}),
      } as RecipeStep;
      return;
    }
  }
  const leftover = leftoverConversationHomePrelude(map, screenId);
  if (!leftover) return;
  found.recipe.steps[found.index] = {
    ...found.step,
    ...leftover,
  } as RecipeStep;
}
