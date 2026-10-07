import type { RecipeStep } from "@relay/protocol";
import { referencedRecipeInputNames } from "./private-inputs.js";
import type { Recipe } from "./recipes.js";

function childIds(step: RecipeStep): string[] {
  return step.kind === "module" || step.kind === "repeat"
    ? [step.recipeId]
    : step.kind === "branch"
      ? [step.thenRecipeId, ...(step.elseRecipeId ? [step.elseRecipeId] : [])]
      : [];
}

/** A placeholder is an external dependency only before a preceding action
 * produces it. Reusable parameters are lexical, and only outputs established
 * on both branch paths can satisfy a later action. */
export function externalRecipeInputDependencies(graph: Record<string, Recipe>): {
  required: string[];
  optional: string[];
} {
  const required = new Set<string>();
  const optional = new Set<string>();
  const invoked = new Set(Object.values(graph).flatMap((recipe) => recipe.steps.flatMap(childIds)));
  const roots = Object.values(graph).filter((recipe) => !invoked.has(recipe.id));
  function walk(recipe: Recipe, provided: Set<string>, stack: Set<string>): Set<string> {
    if (stack.has(recipe.id)) return provided;
    const nested = new Set([...stack, recipe.id]);
    const local = new Set([
      ...Object.keys(recipe.variables ?? {}),
      ...(recipe.parameters ?? []).map((parameter) => parameter.name),
    ]);
    let available = new Set([...provided, ...local]);
    for (const step of recipe.steps) {
      const references = referencedRecipeInputNames({
        ...recipe,
        title: "",
        description: undefined,
        variables: undefined,
        parameters: undefined,
        steps: [step],
      });
      for (const name of references) if (!available.has(name)) required.add(name);
      if (
        (step.kind === "branch" ||
          step.kind === "assert-content" ||
          step.kind === "evaluate-semantic") &&
        !step.input.includes("{{") &&
        !available.has(step.input)
      )
        (step.kind === "branch" ? optional : required).add(step.input);
      const ids = childIds(step);
      if (step.kind === "branch") {
        const paths = ids.map((id) =>
          graph[id] ? walk(graph[id]!, available, nested) : new Set(available),
        );
        if (!step.elseRecipeId) paths.push(new Set(available));
        available = new Set([...paths[0]!].filter((name) => paths.every((path) => path.has(name))));
      } else {
        for (const id of ids) if (graph[id]) available = walk(graph[id]!, available, nested);
      }
      if ("as" in step && typeof step.as === "string") available.add(step.as);
    }
    // Reusable local overlays are restored by the executor at module exit.
    return new Set([...available].filter((name) => !local.has(name) || provided.has(name)));
  }
  for (const root of roots) walk(root, new Set(), new Set());
  return {
    required: [...required].sort(),
    optional: [...optional].filter((name) => !required.has(name)).sort(),
  };
}

export function externalRecipeInputNames(graph: Record<string, Recipe>): string[] {
  const dependencies = externalRecipeInputDependencies(graph);
  return [...dependencies.required, ...dependencies.optional].sort();
}
