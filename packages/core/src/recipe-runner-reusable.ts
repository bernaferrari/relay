/** Resolve a reusable flow and scope its input overlay to that nested run. */
import type { Device } from "./device.js";
import { now } from "./events.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { resolveRecipeStep } from "./recipe-runner-support.js";
import { readRecipe, type RecipeStep } from "./recipes.js";

export type RunRecipeStep = (
  device: Device,
  step: RecipeStep,
  ctx: RecipeStepContext,
) => Promise<void>;

export async function runReusableRecipe(
  device: Device,
  recipeId: string,
  ctx: RecipeStepContext,
  runStep: RunRecipeStep,
  bindings?: Record<string, string>,
): Promise<void> {
  const stack = ctx.moduleStack ?? [];
  if (stack.includes(recipeId))
    throw new Error(`reusable test cycle: ${[...stack, recipeId].join(" → ")}`);
  if (stack.length >= 12) throw new Error("reusable test nesting is limited to 12 levels");
  const recipe = ctx.recipeGraph?.[recipeId] ?? (await readRecipe(recipeId));
  if (!recipe) throw new Error(`reusable test not found: ${recipeId}`);
  const current = ctx.job?.resolvedInputs;
  const parameters = recipe.parameters ?? [];
  const declared = new Set(parameters.map((parameter) => parameter.name));
  for (const name of Object.keys(bindings ?? {})) {
    if (!declared.has(name)) {
      throw new Error(`reusable flow ${recipe.title} does not declare input ${name}`);
    }
  }

  const touched = new Map<string, string | undefined>();
  const resolved: Record<string, string> = {};
  if (current) {
    const overlay: Record<string, string> = { ...recipe.variables };
    for (const parameter of parameters) {
      const value =
        bindings?.[parameter.name] ??
        current[parameter.name] ??
        parameter.default ??
        recipe.variables?.[parameter.name];
      if (value === undefined && parameter.required) {
        throw new Error(`reusable flow ${recipe.title} requires input ${parameter.name}`);
      }
      if (value !== undefined) {
        overlay[parameter.name] = value;
        resolved[parameter.name] = value;
      }
    }
    for (const [name, value] of Object.entries(overlay)) {
      touched.set(name, current[name]);
      current[name] = value;
    }
    if (parameters.length > 0) {
      ctx.job?.artifacts.push({
        kind: "reusable-flow-inputs",
        capturedAt: now(),
        data: {
          recipeId: recipe.id,
          title: recipe.title,
          declared: parameters.map(({ name, required, default: defaultValue }) => ({
            name,
            ...(required ? { required: true } : {}),
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
          })),
          bindings: bindings ?? {},
          resolved,
        },
      });
    }
  }
  ctx.log(
    `↳ ${recipe.title} · ${recipe.steps.length} step(s)${parameters.length ? ` · ${Object.keys(resolved).length}/${parameters.length} inputs` : ""}`,
  );
  try {
    for (const child of recipe.steps) {
      await runStep(device, resolveRecipeStep(child, ctx.job?.resolvedInputs ?? {}), {
        ...ctx,
        moduleStack: [...stack, recipeId],
      });
    }
  } finally {
    if (current) {
      for (const [name, previous] of touched) {
        if (previous === undefined) delete current[name];
        else current[name] = previous;
      }
    }
  }
}
