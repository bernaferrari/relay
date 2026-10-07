import type { AppMapCombinePreflightIssue, AppMapVariable, TestData } from "@relay/protocol";
import { CasePlanError } from "./case-plan.js";
import { requirePublicInputDataSet } from "./input-data-set.js";

/** Only complete compilation can prove absence of an external input. A mixed
 * Plan may intentionally leave this dimension unused by some of its children. */
export function unusedInputDataSetWarnings(input: {
  variables: readonly AppMapVariable[];
  selected?: Record<string, string[]>;
  definitions: readonly TestData[];
  externalInputNames: ReadonlySet<string>;
}): AppMapCombinePreflightIssue[] {
  return input.variables.flatMap((variable) => {
    if (variable.apply.kind !== "input") return [];
    const selectedIds = input.selected?.[variable.id] ?? variable.options.map((row) => row.id);
    const rows = variable.options.filter((row) => selectedIds.includes(row.id));
    if (!rows.length || selectedIds.some((id) => !rows.some((row) => row.id === id))) return [];
    let definition: TestData;
    try {
      definition = requirePublicInputDataSet({
        inputId: variable.apply.inputId,
        definitions: input.definitions,
        values: rows.map((row) => row.value ?? ""),
      });
    } catch (error) {
      if (error instanceof CasePlanError) return [];
      throw error;
    }
    if (
      [definition.id, definition.name].some((alias) => input.externalInputNames.has(alias.trim()))
    )
      return [];
    return [
      {
        code: "unused-input-data-set",
        message: `“${variable.name}” is not used by these Tests. Connect a Type step to Run input “${definition.name}”.`,
        variableId: variable.id,
        inputId: definition.id,
        inputName: definition.name,
      },
    ];
  });
}
