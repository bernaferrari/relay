import {
  bindPreparedCombineCellInputs,
  CasePlanError,
  combineCellInputSeed,
  combineCellRuntimeInputValues,
  enumerateAppMapCombineCells,
  freezeRecipeInputs,
  optionSetsForAppMapCombine,
  prepareOptionCasePlan,
  readProjectVariables,
  requirePublicInputDataSet,
  requirePreparedCombineCellInputs,
  restorePreparedCombineCellInputs,
  type PreparedAppMapCombineCell,
} from "@relay/core";
import type {
  AppMap,
  AppMapCombine,
  CaseExpansionStrategy,
  CombineCampaignCase,
} from "@relay/protocol";
import { HttpError } from "./http.js";

function inputError(error: unknown): never {
  if (!(error instanceof CasePlanError)) throw error;
  throw new HttpError(409, error.message, {
    code: error.code,
    recovery:
      "Supply the Test inputs or repair its project Data set, then start a new Run Across. Frozen campaign inputs are never regenerated during resume.",
  });
}

/** Approval only: reject invalid public rows before live profile health reads.
 * Generation and the authoritative per-child receipt remain in input freeze. */
export async function assertCombineInputDataSets(
  projectId: string,
  map: AppMap,
  combine: AppMapCombine,
  request: {
    selected?: Record<string, string[]>;
    selectedCellIds?: string[];
    strategy?: CaseExpansionStrategy;
  } = {},
): Promise<void> {
  const sets = combine.variableIds.flatMap((id) => {
    const set = map.variables[id];
    return set?.apply.kind === "input" ? [set] : [];
  });
  if (!sets.length) return;
  try {
    const definitions = await readProjectVariables(projectId);
    const selected = request.selected ?? combine.selected;
    const requested = request.selectedCellIds?.map((id) => id.trim()).filter(Boolean);
    const cells = requested?.length
      ? enumerateAppMapCombineCells({
          combine,
          tests: combine.testIds.flatMap((id) => (map.tests[id] ? [map.tests[id]!] : [])),
          variableIds: combine.variableIds,
          matrix: await prepareOptionCasePlan({
            sets: optionSetsForAppMapCombine(map, combine),
            selected,
            strategy: request.strategy ?? combine.strategy,
          }),
        })
      : undefined;
    if (requested?.some((id) => !cells?.some((cell) => cell.cellId === id)))
      throw new CasePlanError("conflicting-variable", "Choose available cells from the saved Plan");
    for (const set of sets) {
      if (set.apply.kind !== "input") continue;
      const ids = cells
        ? [
            ...new Set(
              cells
                .filter((cell) => requested!.includes(cell.cellId))
                .map((cell) => cell.values[set.id]!),
            ),
          ]
        : selected && Object.hasOwn(selected, set.id)
          ? selected[set.id]!
          : set.options.map((row) => row.id);
      requirePublicInputDataSet({
        inputId: set.apply.inputId,
        definitions: definitions.value,
        values: ids.map((id) => set.options.find((row) => row.id === id)?.value ?? ""),
      });
    }
  } catch (error) {
    inputError(error);
  }
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
