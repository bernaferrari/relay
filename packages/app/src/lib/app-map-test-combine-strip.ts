import {
  capturePolicyForLens,
  combineIdFor,
  combineLensName,
  variableCanApply,
  type AppMapCapturePolicy,
  type AppMapScenarioTest,
  type AppMapVariable,
  type CombineLensInput,
  type CombineLensName,
} from "@relay/protocol";
import {
  combineCells,
  combineValueLabel,
  projectCombine,
  type CombineCell,
  type CombineTestColumn,
  type CombineVariable,
  type CombineWorld,
} from "./app-map-combine-presentation";

export type TestCombineLens = CombineLensName;

export { variableCanApply };

export function applyableVariables(variables: readonly AppMapVariable[]): AppMapVariable[] {
  return variables.filter(variableCanApply);
}

export function testCombineLensFromPolicy(
  mode: AppMapCapturePolicy["mode"] | undefined,
): TestCombineLens {
  if (mode === "failures-only") return "smoke";
  return "visual";
}

export function testCombineCaptureForLens(lens: TestCombineLens): AppMapCapturePolicy {
  return capturePolicyForLens(lens);
}

export function projectTestCombineStrip(input: {
  test: Pick<AppMapScenarioTest, "id" | "name">;
  variables: readonly AppMapVariable[];
  selected: Record<string, string[]>;
}): {
  variables: CombineVariable[];
  worlds: CombineWorld[];
  cells: CombineCell[];
  column: CombineTestColumn;
  combineId: string;
} {
  const column: CombineTestColumn = { id: input.test.id, name: input.test.name, kind: "scenario" };
  const projectedVariables: CombineVariable[] = input.variables.map((variable) => {
    const selected = input.selected[variable.id];
    const options = selected?.length
      ? variable.options.filter((option) => selected.includes(option.id))
      : variable.options;
    return {
      id: variable.id,
      name: variable.name,
      values: options.map((option) => ({
        id: option.id,
        label: combineValueLabel(option),
      })),
    };
  });
  const projection = projectCombine(projectedVariables, [column], "cartesian");
  return {
    variables: projectedVariables,
    worlds: projection.worlds,
    cells: combineCells(projection.worlds, [column]),
    column,
    combineId: combineIdFor(
      input.variables.map((variable) => variable.id),
      [input.test.id],
    ),
  };
}

export function testCombineSentence(input: {
  testName: string;
  worlds: readonly CombineWorld[];
  lens: TestCombineLens;
}): string {
  const values = input.worlds.map((world) => world.label).filter(Boolean);
  const worldLabel =
    values.length === 0
      ? "no selected values"
      : values.length === 1
        ? values[0]
        : values.length === 2
          ? `${values[0]} and ${values[1]}`
          : `${values.length} selected values`;
  const lensLabel = input.lens === "smoke" ? "smoke" : "visual";
  return `Run ${input.testName} in ${worldLabel} as a ${lensLabel}.`;
}

export { combineLensName, type CombineLensInput };
