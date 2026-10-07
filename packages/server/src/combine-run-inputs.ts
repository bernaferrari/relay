import {
  bindPreparedCombineCellInputs,
  CasePlanError,
  combineCellInputSeed,
  combineCellRuntimeInputValues,
  freezeRecipeInputs,
  readProjectVariables,
  requirePreparedCombineCellInputs,
  restorePreparedCombineCellInputs,
  type PreparedAppMapCombineCell,
} from "@relay/core";
import type { CombineCampaignCase } from "@relay/protocol";
import { HttpError } from "./http.js";

function inputError(error: unknown): never {
  if (!(error instanceof CasePlanError)) throw error;
  throw new HttpError(409, error.message, {
    code: error.code,
    recovery:
      "Supply the Test inputs or repair its project Data set, then start a new Run Across. Frozen campaign inputs are never regenerated during resume.",
  });
}

/** Complete the entire selected scope before binding any cell or admitting a target. */
export async function freezeCombineRunInputs(input: {
  projectId: string;
  cells: PreparedAppMapCombineCell[];
  variables?: Record<string, string>;
  seed: number;
  readProjectVariables?: typeof readProjectVariables;
}): Promise<void> {
  try {
    const definitions = await (input.readProjectVariables ?? readProjectVariables)(input.projectId);
    const cells = [...new Set(input.cells)];
    const runtimeValues = cells.map((cell) =>
      combineCellRuntimeInputValues({
        cell,
        definitions: definitions.value,
        runtimeValues: input.variables,
      }),
    );
    const prepared = await Promise.all(
      cells.map((cell, index) =>
        freezeRecipeInputs({
          recipeGraph: cell.childIntent.recipeGraph,
          definitions,
          runtimeValues: runtimeValues[index],
          seed: combineCellInputSeed(input.seed, cell),
        }),
      ),
    );
    for (const [index, cell] of cells.entries()) {
      const inputs = prepared[index];
      if (inputs) bindPreparedCombineCellInputs(cell, inputs);
    }
  } catch (error) {
    inputError(error);
  }
}

export function restoreCombineRunInputs(
  cells: PreparedAppMapCombineCell[],
  cases: CombineCampaignCase[],
): void {
  try {
    for (const cell of cells) {
      const item = cases.find((item) =>
        item.executionCaseId
          ? item.executionCaseId === (cell.executionCaseId ?? cell.cellId)
          : item.cellId === cell.cellId && item.targetProfileId === cell.targetProfileId,
      );
      if (item?.frozenInputs) restorePreparedCombineCellInputs(cell, item.frozenInputs);
    }
  } catch (error) {
    inputError(error);
  }
}

export function requireCombineRunInputs(cells: PreparedAppMapCombineCell[]): void {
  try {
    requirePreparedCombineCellInputs(cells);
  } catch (error) {
    inputError(error);
  }
}
