import {
  assertTestInboxesAvailable,
  resolveSavedSignIn,
  savedSignInKeysForRecipeGraph,
  SavedSignInResolutionError,
  TestInboxResolutionError,
} from "@relay/core";
import type { Recipe } from "@relay/core";
import { HttpError } from "../http.js";

/** Non-secret scheduling-time fact about one resolved sign-in. Credentials
 * are deliberately dropped inside this boundary; only the logical key and its
 * credential provenance may influence overlap admission. */
export type RunSavedSignInAdmission = {
  key: string;
  source: "environment" | "local";
  reference?: string;
};

/** Resolve every saved sign-in referenced by the frozen graph before any
 * target control or queue admission. Responses carry only logical key/status
 * metadata, never credentials. The returned source is scheduling metadata:
 * environment overlays are ambient and must not prove account separability. */
export async function assertRunSavedSignInsAvailable(input: {
  projectId: string;
  recipeGraph: Record<string, Recipe>;
}): Promise<RunSavedSignInAdmission[]> {
  try {
    const admissions: RunSavedSignInAdmission[] = [];
    for (const key of savedSignInKeysForRecipeGraph(input.recipeGraph)) {
      const resolved = await resolveSavedSignIn({ projectId: input.projectId, key });
      admissions.push({
        key,
        source: resolved.source,
        ...(resolved.reference ? { reference: resolved.reference } : {}),
      });
    }
    await assertTestInboxesAvailable(input);
    return admissions;
  } catch (error) {
    if (error instanceof TestInboxResolutionError) {
      throw new HttpError(409, error.message, {
        code: "TEST_INBOX_UNAVAILABLE",
        inboxKey: error.key,
        inboxStatus: error.code,
        recovery: error.recovery,
        recoveryAction: {
          operationId: "inbox.check",
          input: { key: error.key },
          cli: { argv: ["inbox", "check", error.key] },
        },
      });
    }
    if (error instanceof SavedSignInResolutionError) {
      throw new HttpError(409, error.message, {
        code: "SAVED_SIGN_IN_UNAVAILABLE",
        signInKey: error.key,
        signInStatus: error.code,
        recovery: error.recovery,
        recoveryAction: {
          operationId: "sign-in.resolve-check",
          input: { key: error.key },
          cli: { argv: ["sign-in", "resolve-check", error.key] },
        },
      });
    }
    throw error;
  }
}
