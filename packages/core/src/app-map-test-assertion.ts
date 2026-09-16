import type {
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AssertionSpec,
  RecipeStep,
} from "@relay/protocol";
import { layoutAssertionRecipeStep } from "./app-map-test-layout-assertion.js";
import { appMapTestCompileFail } from "./app-map-test-compile-error.js";
import { compiledJudgeFields } from "./judge-assertion-fields.js";
import { screenExpectation } from "./app-map-compiler.js";

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
    const compiled = screenExpectation(map, screen, `relay-test-${step.id}`);
    if (compiled.kind !== "expect-screen") {
      appMapTestCompileFail(
        "missing-reference",
        test,
        step,
        `Screen ${assertion.screenId} produced a malformed expectation`,
      );
    }
    const { id: _id, evidenceSurface: _surface, expectedApp: _app, ...rest } = compiled;
    return rest;
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
      ...compiledJudgeFields(assertion),
    };
  }
  if (assertion.kind === "semantic") {
    return {
      kind: "evaluate-semantic",
      input: assertion.input,
      criteria: [...assertion.criteria],
      ...compiledJudgeFields(assertion),
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
