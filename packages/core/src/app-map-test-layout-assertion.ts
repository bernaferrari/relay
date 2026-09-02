import type { AssertionSpec, RecipeStep } from "@relay/protocol";

export function layoutAssertionRecipeStep(
  assertion: Extract<AssertionSpec, { kind: "layout" }>,
): Extract<RecipeStep, { kind: "assert-layout" }> {
  return {
    kind: "assert-layout",
    relation: assertion.relation,
    first: structuredClone(assertion.first),
    second: structuredClone(assertion.second),
    ...(assertion.timeoutMs === undefined ? {} : { timeoutMs: assertion.timeoutMs }),
  };
}
