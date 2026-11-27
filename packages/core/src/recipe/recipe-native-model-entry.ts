import type { AppMapCompiledTest } from "@relay/protocol";
import type { RecipeStep } from "./recipes.js";

export type NativePendingModelSelectionResolver = (
  plan: AppMapCompiledTest,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
) => boolean;

const nativePendingModelSelectionResolvers: NativePendingModelSelectionResolver[] = [];

/** Register product-specific reviewed evidence for a remembered default model selection. */
export function registerNativePendingModelSelectionResolver(
  resolver: NativePendingModelSelectionResolver,
): () => void {
  nativePendingModelSelectionResolvers.push(resolver);
  return () => {
    const index = nativePendingModelSelectionResolvers.indexOf(resolver);
    if (index >= 0) nativePendingModelSelectionResolvers.splice(index, 1);
  };
}

/** Product extensions may relax this proof only when their registered resolver recognizes the exact frozen sequence. */
export function nativePendingModelSelection(
  plan: AppMapCompiledTest,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
): boolean {
  return nativePendingModelSelectionResolvers.some((resolver) => resolver(plan, step));
}
