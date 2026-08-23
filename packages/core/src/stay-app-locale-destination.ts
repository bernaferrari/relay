import type { RecipeStep } from "@relay/protocol";
import type { Recipe } from "./recipes.js";

type ExpectScreen = Extract<RecipeStep, { kind: "expect-screen" }>;

function isRecoveryOnlyRecipeId(id: string): boolean {
  return id.includes(":confirm:") || id.includes(":proposed-cold-recovery:");
}

/** Source / warm / recovery-only checks are not the product destination. */
function isProductExpectScreen(step: ExpectScreen, recipeId: string): boolean {
  if (isRecoveryOnlyRecipeId(recipeId)) return false;
  const id = step.id ?? "";
  if (id.startsWith("relay-source-")) return false;
  if (id.endsWith(":warm")) return false;
  return true;
}

function lastProductExpectScreen(
  graph: Record<string, Recipe>,
  rootId: string,
  seen = new Set<string>(),
): ExpectScreen | undefined {
  if (seen.has(rootId)) return undefined;
  seen.add(rootId);
  const recipe = graph[rootId];
  if (!recipe) return undefined;
  let last: ExpectScreen | undefined;
  for (const step of recipe.steps) {
    if (step.kind === "expect-screen" && isProductExpectScreen(step, rootId)) {
      last = structuredClone(step);
      continue;
    }
    if (step.kind === "module" && step.recipeId) {
      const nested = lastProductExpectScreen(graph, step.recipeId, seen);
      if (nested) last = nested;
    }
  }
  return last;
}

/** Stay when the Test names a destination. Relaunch only if stay cannot be
 * proved — we cannot stay on a screen we cannot name. */
export function appLocaleShouldRelaunch(
  apply: { relaunch?: boolean },
  graph?: Record<string, Recipe>,
  childRootId?: string,
): boolean {
  if (apply.relaunch === true) return true;
  if (apply.relaunch === false) return false;
  if (!graph || !childRootId) return true;
  return lastProductExpectScreen(graph, childRootId) === undefined;
}

/** Stay applies must re-prove the Test destination. Missing identity is not
 * a new screen — the runner fails closed instead of inventing one. */
export function stayAppLocaleDestinationCheck(
  graph: Record<string, Recipe>,
  childRootId: string,
): RecipeStep | undefined {
  const destination = lastProductExpectScreen(graph, childRootId);
  if (!destination) return undefined;
  const { recovery: _recovery, repairCheckpoint: _repair, ...check } = destination;
  return {
    ...check,
    id: destination.id ? `${destination.id}-stay` : "stay-destination",
  };
}
