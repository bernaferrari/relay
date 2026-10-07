import { createHash } from "node:crypto";
import type { FrozenRecipeInputReceipt, TestData } from "@relay/protocol";
import { createAppMapCombineCellExecutionIntent } from "./app-map-combine-cell-intent.js";
import type { PreparedAppMapCombineCell } from "./app-map-combine-cell-prepare.js";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import { CasePlanError } from "./case-plan.js";
import {
  frozenRecipeInputsMatch,
  parseFrozenRecipeInputReceipt,
  type PreparedFrozenRecipeInputs,
} from "./frozen-recipe-inputs.js";
import { PRIVATE_INPUT } from "./private-inputs.js";
import {
  resolveRecipeInputReferences,
  type SelectedRecipeInputRow,
} from "./recipe-input-references.js";

export function selectedCombineDataRows(
  sets: readonly { id: string; name: string }[],
  values: Record<string, string>,
): SelectedRecipeInputRow[] {
  return sets.map((set) => ({ id: set.id, name: set.name, valueId: values[set.id]! }));
}

/** Validate the full selected scope before any input generator can run. Only
 * approved external child values cross from row identities into Test inputs. */
export function combineCellRuntimeInputValues(input: {
  cell: PreparedAppMapCombineCell;
  definitions: readonly TestData[];
  runtimeValues?: Record<string, string>;
}): Record<string, string> {
  const selectedRows =
    input.cell.selectedDataRows ??
    Object.entries(input.cell.values).map(([id, valueId]) => ({ id, valueId }));
  if (
    selectedRows.length !== Object.keys(input.cell.values).length ||
    new Set(selectedRows.map((row) => row.id)).size !== selectedRows.length ||
    selectedRows.some((row) => input.cell.values[row.id] !== row.valueId)
  )
    throw new CasePlanError("conflicting-variable", "Selected rows conflict with their saved cell");
  const resolved = resolveRecipeInputReferences({
    recipeGraph: input.cell.childIntent.recipeGraph,
    definitions: input.definitions,
    runtimeValues: input.runtimeValues,
    selectedRows,
  });
  if (
    [...resolved.names, ...resolved.definitions.map((definition) => definition.name)].some((name) =>
      Object.hasOwn(input.cell.wrapperInputs, name),
    )
  )
    throw new CasePlanError(
      "conflicting-variable",
      "A Test input conflicts with its Combine wrapper inputs",
    );
  return resolved.runtimeValues;
}

/** A durable occurrence and execution profile resolve the same generator seed.
 * Different cells receive independent seeds without changing their graph. */
export function combineCellInputSeed(seed: number, cell: PreparedAppMapCombineCell): number {
  return createHash("sha256")
    .update(`${seed}:${cell.executionCaseId ?? cell.cellId}`)
    .digest()
    .readUInt32BE(0);
}

export function bindPreparedCombineCellInputs(
  cell: PreparedAppMapCombineCell,
  inputs: PreparedFrozenRecipeInputs,
): void {
  if (Object.keys(inputs.variables).some((name) => Object.hasOwn(cell.wrapperInputs, name)))
    throw new CasePlanError(
      "conflicting-variable",
      "A Test input conflicts with its Combine wrapper inputs",
    );
  const childIntent = createAppMapTestExecutionIntent({
    plan: cell.childIntent.plan,
    recipeGraph: cell.childIntent.recipeGraph,
    preflight: cell.childIntent.preflight,
    laneId: cell.childIntent.laneId,
    frozenInputs: inputs.receipt,
  });
  const outerIntent = createAppMapCombineCellExecutionIntent({
    cellId: cell.cellId,
    testId: cell.testId,
    values: cell.values,
    selectedRuntimeTargetProfile: cell.selectedRuntimeTargetProfile,
    child: childIntent,
    wrapperRoot: cell.recipeSnapshot,
    recipeGraph: cell.recipeGraph,
    staticInputs: cell.staticInputs,
    nativeCompanion: cell.nativeCompanion,
  });
  cell.childIntent = childIntent;
  cell.outerIntent = outerIntent;
  cell.runtimeInputs = structuredClone(inputs);
}

/** Restores only the admitted public values; a private pending case requires
 * fresh local inputs and cannot be silently regenerated during resume. */
export function restorePreparedCombineCellInputs(
  cell: PreparedAppMapCombineCell,
  value: FrozenRecipeInputReceipt,
): void {
  const receipt = parseFrozenRecipeInputReceipt(value);
  if (!receipt)
    throw new CasePlanError(
      "conflicting-variable",
      "The campaign's frozen Test inputs are malformed",
    );
  bindPreparedCombineCellInputs(cell, {
    variables: Object.fromEntries(
      Object.entries(receipt.values).filter(([, value]) => value !== PRIVATE_INPUT),
    ),
    sensitiveInputNames: receipt.sensitiveInputNames,
    receipt,
  });
}

export function requirePreparedCombineCellInputs(
  cells: readonly PreparedAppMapCombineCell[],
): void {
  for (const cell of cells) {
    if (
      cell.childIntent.frozenInputs &&
      !frozenRecipeInputsMatch(cell.childIntent.frozenInputs, cell.runtimeInputs?.variables)
    )
      throw new CasePlanError(
        "missing-private-value",
        "The campaign's frozen Test inputs are unavailable; start a new Run with local values",
      );
  }
}
