import type { AppMapCompiledTest } from "@relay/protocol";
import type { RecipeStep } from "./recipes.js";

/** An editor opened immediately before an explicit model tap may restore a
 * previous default. Derive this exception only from the frozen execution
 * sequence; model destinations and explicitly authored counts stay strict. */
export function nativeImaginePendingModelSelection(
  plan: AppMapCompiledTest,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
): boolean {
  if (plan.appMapId !== "grok-android" || !step.id) return false;
  const flattened: RecipeStep[] = [];
  const walk = (id: string, ancestors: Set<string>): boolean => {
    if (ancestors.has(id) || ancestors.size > 24 || !plan.recipes[id]) return false;
    const next = new Set([...ancestors, id]);
    for (const item of plan.recipes[id]!.steps) {
      if (item.kind === "module") {
        if (!walk(item.recipeId, next)) return false;
      } else flattened.push(item as RecipeStep);
      if (flattened.length > 1_000) return false;
    }
    return true;
  };
  if (!walk(plan.rootRecipeId, new Set())) return false;
  const candidates = flattened.flatMap((item, index) =>
    item.kind === "expect-screen" && item.id === step.id && item.screenId === step.screenId
      ? [index]
      : [],
  );
  if (candidates.length !== 1) return false;
  // Any count choice/parameter makes the captured count an authored value.
  if (
    Object.values(plan.recipes).some((recipe) =>
      recipe.parameters.some((parameter) =>
        [parameter.name, parameter.label].some((value) => /count/iu.test(value ?? "")),
      ),
    )
  )
    return false;
  if (
    flattened.some(
      (item) =>
        item.kind === "tap" &&
        [
          item.target.label,
          item.target.identifier,
          item.target.text,
          item.target.relation?.anchor.label,
          item.target.relation?.anchor.identifier,
        ].some((value) => /(?:image.?count|^auto$|^x\s*\d+$)/iu.test(value?.trim() ?? "")),
    )
  )
    return false;
  const index = candidates[0]!;
  const incidental = (item: RecipeStep): boolean =>
    ["expect-screen", "screenshot", "identity-ignore"].includes(item.kind);
  const before = flattened
    .slice(0, index)
    .reverse()
    .find((item) => !incidental(item));
  const after = flattened.slice(index + 1).find((item) => !incidental(item));
  return (
    before?.kind === "tap" &&
    before.target.label === "Type to imagine" &&
    after?.kind === "tap" &&
    /^(?:Speed|Quality(?:\s+\d+(?:\.\d+)*)?)$/u.test(after.target.label ?? "")
  );
}
