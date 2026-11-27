import {
  assertSavedSignInsAvailable,
  assertTestInboxesAvailable,
  SavedSignInResolutionError,
  TestInboxResolutionError,
} from "@relay/core";
import type { Recipe } from "@relay/core";
import { HttpError } from "../http.js";

/** Resolve every saved sign-in referenced by the frozen graph before any
 * target control or queue admission. Responses carry only logical key/status
 * metadata, never credentials. */
export async function assertRunSavedSignInsAvailable(input: {
  projectId: string;
  recipeGraph: Record<string, Recipe>;
}): Promise<void> {
  try {
    await assertSavedSignInsAvailable(input);
    await assertTestInboxesAvailable(input);
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
