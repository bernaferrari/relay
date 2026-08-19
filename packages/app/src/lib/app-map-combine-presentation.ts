import { CaseExpansionError, expandCaseIndexes, type CaseExpansionStrategy } from "@relay/protocol";

/** User-facing projection for a combine: Variables × Tests. */
export type CombineValue = {
  id: string;
  label: string;
};

export type CombineVariable = {
  id: string;
  name: string;
  values: CombineValue[];
};

export type CombineTestColumn = {
  id: string;
  name: string;
  kind: "scenario";
};

export type CombineWorld = {
  id: string;
  label: string;
  values: Record<string, CombineValue>;
};

export type CombineCell = {
  worldId: string;
  testId: string;
  worldLabel: string;
  testName: string;
};

export type CombineProjection = {
  worlds: CombineWorld[];
  totalWorlds: number;
  cellCount: number;
  truncated: boolean;
  issue?: string;
};

export function combineValueLabel(option: { id: string; label?: string; text?: string }): string {
  const label = option.label?.trim() || option.text?.trim() || option.id.trim();
  return label || option.id;
}

export function combineHeadline(input: {
  variableNames?: string[];
  testNames?: string[];
  variableName?: string;
  testName?: string;
  cellCount: number;
}): string {
  const variables = (input.variableNames ?? [input.variableName ?? ""])
    .map((name) => name.trim())
    .filter(Boolean);
  const tests = (input.testNames ?? [input.testName ?? ""])
    .map((name) => name.trim())
    .filter(Boolean);
  if (!variables.length && !tests.length) return "New Combine";
  if (!variables.length) return "New Combine";
  if (!tests.length) return variables.join(" × ");
  const testGroup = tests.length > 1 ? `(${tests.join(" + ")})` : tests[0];
  return `${variables.join(" × ")} × ${testGroup}`;
}

export function combineSubhead(input: {
  cellCount: number;
  worldCount?: number;
  testCount?: number;
  hasVariable: boolean;
  hasTest: boolean;
  screenshotCount?: number;
}): string {
  if (!input.hasVariable) return "Choose a Variable such as language, account, or model.";
  if (!input.hasTest) return "Choose one or more paths to test.";
  const worlds = input.worldCount ?? input.cellCount;
  const tests = input.testCount ?? 1;
  if (input.cellCount <= 1) return "One device run with one test.";
  const screenshots =
    input.screenshotCount !== undefined
      ? ` · ${input.screenshotCount} ${input.screenshotCount === 1 ? "screenshot" : "screenshots"}`
      : "";
  return `${worlds} device ${worlds === 1 ? "run" : "runs"} · ${input.cellCount} ${input.cellCount === 1 ? "check" : "checks"} across ${tests} ${tests === 1 ? "test" : "tests"}${screenshots}.`;
}

function worldLabel(variables: CombineVariable[], values: Record<string, CombineValue>): string {
  const parts = variables.map((variable) => {
    const value = values[variable.id];
    return variables.length === 1 ? value?.label : `${variable.name}: ${value?.label ?? "—"}`;
  });
  return parts.filter(Boolean).join(" · ") || "Once";
}

/** Build the exact, bounded visual plan with the same expansion as execution. */
export function projectCombine(
  variables: CombineVariable[],
  tests: CombineTestColumn[],
  strategy: CaseExpansionStrategy,
  limit = 32,
): CombineProjection {
  if (!variables.length || !tests.length || variables.some((variable) => !variable.values.length)) {
    return { worlds: [], totalWorlds: 0, cellCount: 0, truncated: false };
  }
  let rows: number[][];
  try {
    rows = expandCaseIndexes(
      variables.map((variable) => variable.values.length),
      strategy,
      250,
    );
  } catch (error) {
    const issue =
      error instanceof CaseExpansionError ? error.message : "Could not build this combine.";
    return { worlds: [], totalWorlds: 0, cellCount: 0, truncated: false, issue };
  }
  const worlds: CombineWorld[] = [];
  for (const indexes of rows.slice(0, limit)) {
    const values = Object.fromEntries(
      variables.map((variable, variableIndex) => [
        variable.id,
        variable.values[indexes[variableIndex]!]!,
      ]),
    );
    worlds.push({
      id: Object.values(values)
        .map((value) => value.id)
        .join("|"),
      label: worldLabel(variables, values),
      values,
    });
  }
  return {
    worlds,
    totalWorlds: rows.length,
    cellCount: rows.length * tests.length,
    truncated: worlds.length < rows.length,
  };
}

export function combineCells(worlds: CombineWorld[], tests: CombineTestColumn[]): CombineCell[] {
  const cells: CombineCell[] = [];
  for (const world of worlds) {
    for (const test of tests) {
      cells.push({
        worldId: world.id,
        testId: test.id,
        worldLabel: world.label,
        testName: test.name,
      });
    }
  }
  return cells;
}
