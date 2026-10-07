import type { TestData } from "@relay/protocol";
import { CasePlanError, prepareCasePlan, type PreparedCasePlan } from "./case-plan.js";
import { externalRecipeInputDependencies } from "./recipe-input-dependencies.js";
import type { Recipe } from "./recipes.js";

/** Resolve only dependencies of the frozen graph. A single Test always gets
 * one case; a list's first value is the default, while runtime values override it. */
export async function prepareFrozenRecipeInputs(input: {
  recipeGraph: Record<string, Recipe>;
  definitions: TestData[];
  runtimeValues?: Record<string, string>;
  seed?: number;
}): Promise<{
  variables: Record<string, string>;
  sensitiveInputNames: string[];
  matrix?: PreparedCasePlan;
}> {
  const dependencies = externalRecipeInputDependencies(input.recipeGraph);
  const names = [...dependencies.required, ...dependencies.optional];
  const selected = input.definitions
    .filter((definition) => names.includes(definition.id) || names.includes(definition.name))
    .filter((definition) => {
      if (
        dependencies.required.includes(definition.id) ||
        dependencies.required.includes(definition.name)
      )
        return true;
      if ((input.runtimeValues?.[definition.name] ?? input.runtimeValues?.[definition.id])?.trim())
        return true;
      if (definition.scope === "private") return false;
      return Boolean(
        definition.values?.some((value) => value.trim()) ||
        definition.fallback?.trim() ||
        (definition.source === "generated" && definition.prompt?.trim()),
      );
    })
    .map((definition) => definition.id);
  const definitions = input.definitions.filter((definition) => selected.includes(definition.id));
  const byReference = new Map(
    definitions.flatMap((definition) => [
      [definition.id, definition] as const,
      [definition.name, definition] as const,
    ]),
  );
  const matrix = selected.length
    ? await prepareCasePlan({
        variables: definitions,
        dataIds: selected,
        repetitions: 1,
        runtimeValues: input.runtimeValues,
        seed: input.seed,
      })
    : undefined;
  const variables: Record<string, string> = { ...matrix?.cases[0]?.values };
  for (const reference of names) {
    const definition = byReference.get(reference);
    const value = definition ? variables[definition.name] : input.runtimeValues?.[reference];
    if (value !== undefined && value.trim()) variables[reference] = value;
  }
  const missing = dependencies.required.find((name) => variables[name] === undefined);
  if (missing)
    throw new CasePlanError("missing-variable", `Input “${missing}” has no value for this run`);
  const sensitiveInputNames = definitions
    .filter((definition) => definition.scope === "private" || definition.sensitive)
    .flatMap((definition) => [definition.name, definition.id])
    .filter((name) => Object.hasOwn(variables, name));
  return {
    variables,
    sensitiveInputNames: [...new Set(sensitiveInputNames)].sort(),
    ...(matrix ? { matrix } : {}),
  };
}
