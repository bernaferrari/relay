import type { TestData } from "@relay/protocol";
import { CasePlanError, prepareCasePlan, type PreparedCasePlan } from "./case-plan.js";
import { resolveRecipeInputReferences } from "./recipe-input-references.js";
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
  const {
    dependencies,
    names,
    definitions: referenced,
    byReference,
    runtimeValues,
  } = resolveRecipeInputReferences(input);
  const definitions = referenced.filter((definition) => {
    if (
      dependencies.required.includes(definition.id) ||
      dependencies.required.includes(definition.name)
    )
      return true;
    if (runtimeValues[definition.name]?.trim()) return true;
    if (definition.scope === "private") return false;
    return Boolean(
      definition.values?.some((value) => value.trim()) ||
      definition.fallback?.trim() ||
      (definition.source === "generated" && definition.prompt?.trim()),
    );
  });
  const matrix = definitions.length
    ? await prepareCasePlan({
        variables: definitions,
        dataIds: definitions.map((definition) => definition.id),
        repetitions: 1,
        runtimeValues,
        seed: input.seed,
      })
    : undefined;
  const variables: Record<string, string> = { ...matrix?.cases[0]?.values };
  for (const reference of names) {
    const definition = byReference.get(reference);
    const value = definition ? variables[definition.name] : runtimeValues[reference];
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
