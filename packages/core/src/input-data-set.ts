import { MAX_INPUT_DATA_SET_VALUE_LENGTH, type AppMap, type TestData } from "@relay/protocol";
import { CasePlanError } from "./case-plan.js";
import { AppMapDomainError } from "./app-map/errors.js";

/** Public matrix rows bind stable Project input IDs and approved literal values.
 * The same check runs before persistence and before any input generation. */
export function requirePublicInputDataSet(input: {
  inputId: string;
  definitions: readonly TestData[];
  values: readonly string[];
}): TestData {
  const candidates = input.definitions.filter((item) => item.id === input.inputId);
  const definition = candidates[0];
  if (candidates.length !== 1 || !definition)
    throw new CasePlanError("conflicting-variable", "Choose one available Project input by ID");
  const aliases = [definition.id, definition.name];
  if (
    input.definitions.some(
      (item) =>
        item !== definition && aliases.some((alias) => [item.id, item.name].includes(alias)),
    )
  )
    throw new CasePlanError("conflicting-variable", "The Project input has conflicting aliases");
  if (
    definition.scope !== "shared" ||
    definition.sensitive ||
    !(definition.source === "list" || definition.source === "static")
  )
    throw new CasePlanError(
      "conflicting-variable",
      "Input Data sets require a public, non-sensitive list or static Project input",
    );
  const values = definition.values?.filter((value) => value.trim().length > 0) ?? [];
  const approved = definition.source === "static" ? values.slice(0, 1) : values;
  if (
    !input.values.length ||
    input.values.some(
      (value) => value.length > MAX_INPUT_DATA_SET_VALUE_LENGTH || !approved.includes(value),
    )
  )
    throw new CasePlanError(
      "conflicting-variable",
      "Choose approved Project input values for every Data set row",
    );
  return definition;
}

/** Check only introduced or edited input dimensions so a later Project edit
 * cannot block unrelated changes to an existing App Map. Runs validate again. */
export function assertAppMapInputDataSetChanges(
  next: AppMap,
  previous: AppMap | undefined,
  definitions: readonly TestData[],
): void {
  for (const set of Object.values(next.variables)) {
    if (
      set.apply.kind !== "input" ||
      JSON.stringify(set) === JSON.stringify(previous?.variables[set.id])
    )
      continue;
    try {
      requirePublicInputDataSet({
        inputId: set.apply.inputId,
        definitions,
        values: set.options.map((row) => row.value ?? ""),
      });
    } catch (error) {
      if (!(error instanceof CasePlanError)) throw error;
      throw new AppMapDomainError("invalid-map", error.message);
    }
  }
}
