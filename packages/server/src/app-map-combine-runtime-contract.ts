import { HttpError } from "./http.js";

type AppMapCombineExecution = {
  appMapId: string;
  testId?: string;
  combineId?: string;
};

/** App Map Combines do not yet freeze one runtime profile and offline
 * preflight per cell. Stop at the server boundary instead of letting a legacy
 * matrix scheduler borrow evidence from another locale or target. */
export function requireAppMapCombineRuntimeProfileContract(input: AppMapCombineExecution): void {
  const testId = input.testId?.trim();
  const combineId = input.combineId?.trim();
  const singleTest = Boolean(testId && !combineId);
  const recoveryAction = singleTest
    ? {
        operationId: "app-map.test.run",
        input: { appMapId: input.appMapId, testId },
      }
    : {
        operationId: "app-map.combine.preflight",
        input: { appMapId: input.appMapId, combineId },
      };
  throw new HttpError(
    409,
    singleTest
      ? "Use app-map.test.run: this legacy Combine endpoint cannot freeze the Test's runtime evidence profile."
      : "This Combine cannot run until every cell has a frozen runtime evidence profile and offline preflight.",
    {
      code: "APP_MAP_COMBINE_RUNTIME_PROFILE_CONTRACT_REQUIRED",
      appMapId: input.appMapId,
      ...(testId ? { testId } : {}),
      ...(combineId ? { combineId } : {}),
      recovery: singleTest
        ? "Run this one Test through app-map.test.run with its selected targetProfileId."
        : "Keep the Combine for review; wait for the explicit per-cell evidence contract before execution.",
      recoveryAction,
      migration: {
        state: "awaiting-per-cell-frozen-runtime-profile",
        ...(singleTest ? { path: "single-test-run" } : { path: "combine-cell-scope" }),
      },
    },
  );
}
