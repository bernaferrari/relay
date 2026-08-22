import type { RecipeStep } from "@relay/protocol";
import type { Recipe } from "./recipes.js";

function firstChildExpectScreen(
  graph: Record<string, Recipe>,
  rootId: string,
  seen = new Set<string>(),
): Extract<RecipeStep, { kind: "expect-screen" }> | undefined {
  if (seen.has(rootId)) return undefined;
  seen.add(rootId);
  const recipe = graph[rootId];
  if (!recipe) return undefined;
  for (const step of recipe.steps) {
    if (step.kind === "expect-screen") return structuredClone(step);
    if (step.kind === "module" && step.recipeId) {
      const nested = firstChildExpectScreen(graph, step.recipeId, seen);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Stay applies must re-prove the Test destination. Missing identity is not
 * a new screen — the runner fails closed instead of inventing one. */
export function stayAppLocaleDestinationCheck(
  graph: Record<string, Recipe>,
  childRootId: string,
): RecipeStep | undefined {
  const destination = firstChildExpectScreen(graph, childRootId);
  if (!destination) return undefined;
  const { recovery: _recovery, repairCheckpoint: _repair, ...check } = destination;
  return {
    ...check,
    id: destination.id ? `${destination.id}-stay` : "stay-destination",
  };
}
