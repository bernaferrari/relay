import type { TestData } from "@relay/protocol";
import { CasePlanError } from "./case-plan.js";
import { requirePublicInputDataSet } from "./input-data-set.js";
import { externalRecipeInputDependencies } from "./recipe-input-dependencies.js";
import type { Recipe } from "./recipes.js";

export type SelectedRecipeInputRow = {
  id: string;
  name?: string;
  inputId?: string;
  value?: string;
  valueId: string;
};

function aliases(definition: Pick<TestData, "id" | "name">): string[] {
  return [...new Set([definition.id, definition.name].map((name) => name.trim()))];
}

/** Resolve aliases before generation. Selected rows remain opaque identities
 * unless one referenced public list/static definition approves that exact value.
 * Selector labels/text never enter this input contract. */
export function resolveRecipeInputReferences(input: {
  recipeGraph: Record<string, Recipe>;
  definitions: readonly TestData[];
  runtimeValues?: Record<string, string>;
  selectedRows?: readonly SelectedRecipeInputRow[];
}) {
  const dependencies = externalRecipeInputDependencies(input.recipeGraph);
  const names = [...dependencies.required, ...dependencies.optional];
  const index = new Map<string, TestData[]>();
  for (const definition of input.definitions) {
    for (const alias of aliases(definition))
      index.set(alias, [...(index.get(alias) ?? []), definition]);
  }
  const byReference = new Map<string, TestData>();
  for (const name of names) {
    const candidates = index.get(name) ?? [];
    if (candidates.length > 1)
      throw new CasePlanError("conflicting-variable", `Input “${name}” matches multiple Data sets`);
    if (candidates[0]) byReference.set(name, candidates[0]);
  }
  const definitions = [...new Set(byReference.values())];
  const runtimeValues: Record<string, string> = {};
  for (const name of names) {
    if (!byReference.has(name) && input.runtimeValues?.[name]?.trim())
      runtimeValues[name] = input.runtimeValues[name]!.trim();
  }
  for (const definition of definitions) {
    const values = new Set<string>();
    for (const alias of aliases(definition)) {
      if (index.get(alias)?.length !== 1)
        throw new CasePlanError(
          "conflicting-variable",
          `Data set alias “${alias}” matches multiple Data sets`,
        );
      const supplied = input.runtimeValues?.[alias];
      const preserveText =
        definition.scope === "shared" &&
        !definition.sensitive &&
        (definition.source === "static" || definition.source === "list");
      const value = preserveText ? supplied : supplied?.trim();
      if (value?.trim()) values.add(value);
    }
    if (values.size > 1)
      throw new CasePlanError(
        "conflicting-variable",
        `Input “${definition.name}” has different values through its ID and name`,
      );
    if (values.size) runtimeValues[definition.name] = [...values][0]!;
  }
  for (const row of input.selectedRows ?? []) {
    if (row.inputId !== undefined) {
      const definition = requirePublicInputDataSet({
        inputId: row.inputId,
        definitions: input.definitions,
        values: [row.value ?? ""],
      });
      // A mixed Plan retains every world dimension, while each Test consumes
      // only the inputs referenced by its own frozen graph.
      if (!definitions.includes(definition)) continue;
      const value = row.value!;
      const supplied = runtimeValues[definition.name];
      if (supplied !== undefined && supplied !== value)
        throw new CasePlanError(
          "conflicting-variable",
          `Selected row and supplied value disagree for input “${definition.name}”`,
        );
      runtimeValues[definition.name] = value;
      continue;
    }
    const rowAliases = [...new Set([row.id, row.name].filter(Boolean) as string[])];
    if (
      !rowAliases.some(
        (alias) =>
          names.includes(alias) || definitions.some((item) => aliases(item).includes(alias)),
      )
    )
      continue;
    const candidates = [...new Set(rowAliases.flatMap((alias) => index.get(alias) ?? []))];
    if (candidates.length !== 1 || !definitions.includes(candidates[0]!))
      throw new CasePlanError(
        "conflicting-variable",
        `Selected Data set “${row.id}” has no unambiguous Project input binding`,
      );
    const definition = candidates[0]!;
    // Public row selection cannot supply a local secret or suppress generation.
    if (definition.scope === "private" || definition.source === "generated") continue;
    const preserveText =
      !definition.sensitive && (definition.source === "static" || definition.source === "list");
    const value = preserveText ? row.valueId : row.valueId.trim();
    if (
      !value.trim() ||
      !definition.values?.some((approved) => (preserveText ? approved : approved.trim()) === value)
    )
      throw new CasePlanError(
        "conflicting-variable",
        `Selected row for “${definition.name}” is not an approved Test input value`,
      );
    const supplied = runtimeValues[definition.name];
    if (supplied !== undefined && supplied !== value)
      throw new CasePlanError(
        "conflicting-variable",
        `Selected row and supplied value disagree for input “${definition.name}”`,
      );
    runtimeValues[definition.name] = value;
  }
  return { dependencies, names, definitions, byReference, runtimeValues };
}
