import {
  claimedAbsentControlReason,
  recipeRecordedLabels,
  type AppMapScenarioTest,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";

function recipeGraphLabels(graph: Readonly<Record<string, Recipe>>): string[] {
  return Object.values(graph).flatMap((recipe) => recipeRecordedLabels(recipe.steps));
}

/** Compile must not call a Test Ready when its title claims an unrecorded control. */
export function compiledTestClaimedAbsentControl(
  test: Pick<AppMapScenarioTest, "name" | "steps">,
  graph: Readonly<Record<string, Recipe>>,
): { stepId: string; reason: string } | undefined {
  const haystack = `${test.name}\n${test.steps.map((step) => step.intent).join("\n")}`;
  const reason = claimedAbsentControlReason(haystack, recipeGraphLabels(graph));
  if (!reason) return undefined;
  const stepId =
    test.steps.find((step) => /start thread/iu.test(`${step.intent}`))?.id ??
    test.steps.find((step) => step.kind === "instruction")?.id ??
    test.steps[0]?.id;
  if (!stepId) return undefined;
  return { stepId, reason };
}
