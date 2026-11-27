import type { Recipe } from "../recipe/recipes.js";
import { normalizeSavedSignInKey } from "./saved-sign-ins.js";
import { resolveSavedSignIn } from "./sign-in-resolution.js";

/** Logical saved sign-ins referenced by a frozen executable graph. */
export function savedSignInKeysForRecipeGraph(recipeGraph: Record<string, Recipe>): string[] {
  const keys = new Set<string>();
  for (const recipe of Object.values(recipeGraph)) {
    for (const step of recipe.steps) {
      if (step.kind === "act" && step.auth?.type === "sign-in") {
        keys.add(normalizeSavedSignInKey(step.auth.accountKey));
      }
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
}

/** Admission resolves every referenced account before a job can be accepted.
 * The plaintext result is deliberately discarded here; execution resolves it
 * again inside the run-local sign-in act. */
export async function assertSavedSignInsAvailable(input: {
  projectId: string;
  recipeGraph: Record<string, Recipe>;
  now?: number;
}): Promise<void> {
  for (const key of savedSignInKeysForRecipeGraph(input.recipeGraph)) {
    await resolveSavedSignIn({
      projectId: input.projectId,
      key,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  }
}
