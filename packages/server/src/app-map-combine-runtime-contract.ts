import { AppMapCombineCellContractError, type PreparedAppMapCombine } from "@relay/core";
import { HttpError } from "./http.js";

export function requireSingleTestUseAppMapTestRun(appMapId: string, testId: string): never {
  throw new HttpError(
    409,
    "Use app-map.test.run: this legacy Combine endpoint cannot freeze the Test's runtime evidence profile.",
    {
      code: "APP_MAP_COMBINE_RUNTIME_PROFILE_CONTRACT_REQUIRED",
      appMapId,
      testId,
      recovery: "Run this one Test through app-map.test.run with its selected targetProfileId.",
      recoveryAction: {
        operationId: "app-map.test.run",
        input: { appMapId, testId },
      },
      migration: {
        state: "awaiting-per-cell-frozen-runtime-profile",
        path: "single-test-run",
      },
    },
  );
}

export function combineCellContractHttpError(error: AppMapCombineCellContractError): HttpError {
  const first = error.issues[0];
  return new HttpError(409, error.message, {
    code: error.code,
    cells: error.cells,
    issues: error.issues,
    ...(first?.cellId ? { cellId: first.cellId } : {}),
    ...(first?.testId ? { testId: first.testId } : {}),
    ...(first?.targetProfileId ? { targetProfileId: first.targetProfileId } : {}),
    recovery:
      "Bind an explicit saved targetProfileId to every selected Test × world cell, then retry. Relay will not borrow another cell's profile.",
    recoveryAction: {
      operationId: "app-map.combine.save",
      input: { cellRuntimeProfiles: "required" },
    },
  });
}

export function assertPreparedCombineCells(prepared: PreparedAppMapCombine): PreparedAppMapCombine {
  if (!prepared.selectedCells.length) {
    throw new HttpError(409, "No selected Combine cells are ready to run.", {
      code: "APP_MAP_COMBINE_CELL_CONTRACT",
      cells: prepared.cellStates,
      recovery: "Select at least one bound Combine cell.",
    });
  }
  return prepared;
}
