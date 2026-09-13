import type {
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AssertionSpec,
  RecipeStep,
} from "@relay/protocol";
import { layoutAssertionRecipeStep } from "./app-map-test-layout-assertion.js";
import { appMapTestCompileFail } from "./app-map-test-compile-error.js";

export function assertionRecipeStep(
  map: AppMap,
  test: AppMapScenarioTest,
  step: AppMapScenarioTestStep,
  assertion: AssertionSpec,
): RecipeStep {
  if (assertion.kind === "screen") {
    const screen = map.screens[assertion.screenId];
    if (!screen) {
      appMapTestCompileFail(
        "missing-reference",
        test,
        step,
        `Screen ${assertion.screenId} does not exist`,
      );
    }
    if (!screen.identity) {
      appMapTestCompileFail(
        "missing-reference",
        test,
        step,
        `Screen ${assertion.screenId} has no approved identity`,
      );
    }
    const observations = screen.variantIds.flatMap((variantId) => {
      const observation = map.screenVariants[variantId]?.observation;
      return observation?.nodes.length ? [structuredClone(observation)] : [];
    });
    return {
      kind: "expect-screen",
      screenId: screen.id,
      screenTitle: screen.title,
      fingerprint: screen.identity.fingerprint,
      timeoutMs: 5_000,
      ...(screen.identity.aliases?.length ? { aliases: [...screen.identity.aliases] } : {}),
      ...(observations.length ? { observations } : {}),
      ...(screen.identity.ignoreRegions?.length
        ? {
            ignoreRegions: screen.identity.ignoreRegions.map((region) => ({ ...region })),
          }
        : {}),
    };
  }
  if (assertion.kind === "target") {
    return {
      kind: "expect",
      target: structuredClone(assertion.target),
      condition: assertion.condition,
      ...(assertion.timeoutMs === undefined ? {} : { timeoutMs: assertion.timeoutMs }),
    };
  }
  if (assertion.kind === "layout") return layoutAssertionRecipeStep(assertion);
  if (assertion.kind === "visual") {
    return {
      kind: "evaluate-visual",
      criteria: [...assertion.criteria],
      ...(assertion.region ? { region: { ...assertion.region } } : {}),
    };
  }
  if (assertion.kind === "semantic") {
    return {
      kind: "evaluate-semantic",
      input: assertion.input,
      criteria: [...assertion.criteria],
      ...(assertion.requireAgreement ? { requireAgreement: true } : {}),
    };
  }
  return {
    kind: "assert-content",
    input: assertion.input,
    expected: assertion.expected,
    match: assertion.match,
    ...(assertion.field ? { field: assertion.field } : {}),
  };
}
