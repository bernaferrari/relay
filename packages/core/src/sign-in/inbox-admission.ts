import type { Recipe } from "../recipe/recipes.js";
import { listSavedSignIns, normalizeSavedSignInKey } from "./saved-sign-ins.js";
import { inboxKeyForSavedSignIn, normalizeTestInboxKey } from "./test-inboxes.js";
import { resolveTestInbox } from "./test-inbox-resolution.js";
import { savedSignInKeysForRecipeGraph } from "./sign-in-admission.js";

/** Logical test inboxes referenced directly by inbox steps, plus the inbox
 * linked to each saved sign-in in the graph. The latter covers the canonical
 * unkeyed phrase, which uses the latest active sign-in at runtime. */
export async function testInboxKeysForRecipeGraph(input: {
  projectId: string;
  recipeGraph: Record<string, Recipe>;
}): Promise<string[]> {
  const keys = new Set<string>();
  const accountKeys = new Set<string>();
  for (const recipe of Object.values(input.recipeGraph)) {
    for (const step of recipe.steps) {
      if (step.kind !== "inbox") continue;
      if (step.inboxKey) keys.add(normalizeTestInboxKey(step.inboxKey));
      if (step.accountKey) accountKeys.add(normalizeSavedSignInKey(step.accountKey));
      if (!step.inboxKey && !step.accountKey) {
        for (const key of savedSignInKeysForRecipeGraph(input.recipeGraph)) accountKeys.add(key);
      }
    }
  }
  for (const accountKey of accountKeys) {
    const records = await listSavedSignIns({ projectId: input.projectId, key: accountKey });
    keys.add(inboxKeyForSavedSignIn(accountKey, records.at(-1)?.inboxKey));
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
}

/** Admission resolves inbox configuration and ciphertext before target control
 * or queue acceptance. Plaintext is discarded; execution resolves it again in
 * run-local memory. */
export async function assertTestInboxesAvailable(input: {
  projectId: string;
  recipeGraph: Record<string, Recipe>;
}): Promise<void> {
  for (const key of await testInboxKeysForRecipeGraph(input)) {
    await resolveTestInbox({ projectId: input.projectId, key });
  }
}
