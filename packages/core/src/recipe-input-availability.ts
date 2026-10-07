import type { TestData } from "@relay/protocol";
import { CasePlanError } from "./case-plan.js";
import { resolveRecipeInputReferences } from "./recipe-input-references.js";
import type { Recipe } from "./recipes.js";

/** Reject already-known input failures before a target observation. Generated
 * values are resolved only once, by the exact compiled graph's input freeze. */
export function assertRecipeInputAvailability(input: {
  recipeGraph: Record<string, Recipe>;
  definitions: readonly TestData[];
  runtimeValues?: Record<string, string>;
}): void {
  const { dependencies, byReference, runtimeValues } = resolveRecipeInputReferences(input);
  for (const reference of dependencies.required) {
    const definition = byReference.get(reference);
    if (runtimeValues[definition?.name ?? reference]?.trim()) continue;
    if (definition?.scope === "private")
      throw new CasePlanError(
        "missing-private-value",
        `Private variable “${definition.name}” needs a local value before this run can start`,
      );
    if (
      definition?.values?.some((value) => value.trim()) ||
      definition?.fallback?.trim() ||
      (definition?.source === "generated" && definition.prompt?.trim())
    )
      continue;
    throw new CasePlanError("missing-variable", `Input “${reference}” has no value for this run`);
  }
}
