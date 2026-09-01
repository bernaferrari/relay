import {
  capturePolicyForLens,
  combineIdFor,
  combineLensName,
  variableCanApply,
  type AppMapCapturePolicy,
  type AppMapCombine,
  type AppMapScenarioTest,
  type AppMapVariable,
  type CaseExpansionStrategy,
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
import { flattenScenarioSteps } from "./app-map-test-editor-tree";

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
  strategy?: CaseExpansionStrategy;
}): {
  variables: CombineVariable[];
  worlds: CombineWorld[];
  cells: CombineCell[];
  column: CombineTestColumn;
  combineId: string;
  totalWorlds: number;
  truncated: boolean;
  issue?: string;
} {
  const column: CombineTestColumn = { id: input.test.id, name: input.test.name, kind: "scenario" };
  const projectedVariables: CombineVariable[] = input.variables.map((variable) => {
    const selected = input.selected[variable.id];
    const options =
      selected === undefined
        ? variable.options
        : variable.options.filter((option) => selected.includes(option.id));
    return {
      id: variable.id,
      name: variable.name,
      values: options.map((option) => ({
        id: option.id,
        label: combineValueLabel(option),
      })),
    };
  });
  const projection = projectCombine(projectedVariables, [column], input.strategy ?? "cartesian");
  return {
    variables: projectedVariables,
    worlds: projection.worlds,
    cells: combineCells(projection.worlds, [column]),
    column,
    totalWorlds: projection.totalWorlds,
    truncated: projection.truncated,
    ...(projection.issue ? { issue: projection.issue } : {}),
    combineId: combineIdFor(
      input.variables.map((variable) => variable.id),
      [input.test.id],
    ),
  };
}

/** Last expect-screen / last bound screen. Combine Whole page binds this. */
export function testDestinationScreenId(
  map: {
    connections: Record<string, { destination?: { kind?: string; screenId?: string } }>;
  },
  test: Pick<AppMapScenarioTest, "steps" | "surfaceBindings">,
): string | undefined {
  let last: string | undefined;
  for (const { step } of flattenScenarioSteps(test.steps)) {
    if (step.binding.status !== "resolved") continue;
    if (step.kind === "instruction" && step.binding.kind === "connections") {
      for (const id of step.binding.connectionIds) {
        const destination = map.connections[id]?.destination;
        if (destination?.kind === "screen") last = destination.screenId;
      }
    } else if (
      step.kind === "validation" &&
      step.binding.kind === "assertion" &&
      step.binding.assertion.kind === "screen"
    ) {
      last = step.binding.assertion.screenId;
    }
  }
  return last ?? test.surfaceBindings?.at(-1)?.screenId;
}

type WholePageMap = {
  connections: Record<string, { destination?: { kind?: string; screenId?: string } }>;
  screens?: Record<string, { variantIds?: string[] }>;
  screenVariants?: Record<
    string,
    { scrollSurfaces?: Array<{ capturePolicy?: { captureMode?: string } }> }
  >;
};

/** Whole page recapture 409s unless this destination already has a frozen
 * full-surface capture or the Test already bound one. */
export function testDestinationHasFullSurfaceBinding(
  map: WholePageMap,
  test: Pick<AppMapScenarioTest, "surfaceBindings">,
  screenId: string,
): boolean {
  if (
    test.surfaceBindings?.some(
      (binding) => binding.screenId === screenId && binding.captureMode === "full-surface",
    )
  ) {
    return true;
  }
  const screen = map.screens?.[screenId];
  if (!screen) return false;
  for (const variantId of screen.variantIds ?? []) {
    const variant = map.screenVariants?.[variantId];
    if (
      variant?.scrollSurfaces?.some(
        (surface) => surface.capturePolicy?.captureMode === "full-surface",
      )
    ) {
      return true;
    }
  }
  return false;
}

export function testWholePageAvailability(
  map: WholePageMap,
  test: Pick<AppMapScenarioTest, "steps" | "surfaceBindings">,
): { destinationScreenId?: string; ready: boolean } {
  const destinationScreenId = testDestinationScreenId(map, test);
  if (!destinationScreenId) return { ready: false };
  return {
    destinationScreenId,
    ready: testDestinationHasFullSurfaceBinding(map, test, destinationScreenId),
  };
}

export function testCombineStripRunInput(input: {
  selected: Record<string, string[]>;
  lens: TestCombineLens;
  cell?: string;
  executionMode?: "pilot" | "all";
  wholePage?: boolean;
  destinationScreenId?: string;
}): {
  in: Record<string, string[]>;
  lens: TestCombineLens;
  cell?: string;
  executionMode?: "pilot" | "all";
  surfaceCapture?: { forceRecaptureScreenIds: string[] };
} {
  const destination = input.destinationScreenId?.trim();
  return {
    in: input.selected,
    lens: input.lens,
    ...(input.cell ? { cell: input.cell } : {}),
    ...(input.executionMode ? { executionMode: input.executionMode } : {}),
    ...(input.wholePage && destination
      ? { surfaceCapture: { forceRecaptureScreenIds: [destination] } }
      : {}),
  };
}

export function testCombineSentence(input: {
  testName: string;
  variableNames?: readonly string[];
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
  const evidenceLabel = input.lens === "smoke" ? "smoke checks" : "visual evidence";
  const dimensionLabel = input.variableNames?.filter(Boolean).join(" × ") || "selection";
  return `Repeat ${input.testName} across ${dimensionLabel}: ${worldLabel} · ${evidenceLabel}`;
}

export const TEACH_LANGUAGE_VARIABLE_HINT = "Teach a language Variable first";

export type ScreenAcrossLanguagesMap = {
  connections: Record<string, { destination?: { kind?: string; screenId?: string } }>;
  tests?: Record<string, Pick<AppMapScenarioTest, "id" | "steps" | "surfaceBindings">>;
  variables?: Record<string, Pick<AppMapVariable, "id" | "kind" | "options">>;
  combines?: Record<string, Pick<AppMapCombine, "id" | "variableIds" | "testIds" | "selected">>;
};

export type ScreenAcrossLanguagesIntent =
  | { kind: "disabled"; hint: string }
  | {
      kind: "run";
      testId: string;
      variableIds: string[];
      selected: Record<string, string[]>;
    }
  | { kind: "open-combine"; combineId?: string; testId?: string };

export function languageVariable(
  variables: ScreenAcrossLanguagesMap["variables"],
): Pick<AppMapVariable, "id" | "kind" | "options"> | undefined {
  const list = Object.values(variables ?? {});
  return (
    list.find((variable) => variable.id === "language") ??
    list.find((variable) => variable.kind === "language")
  );
}

/** Screen-card/inspector action: run the Test that ends here across selected
 * language values, or open Combine instead of firing every option. */
export function screenAcrossLanguages(
  map: ScreenAcrossLanguagesMap | undefined,
  screenId: string | undefined,
): ScreenAcrossLanguagesIntent {
  const language = languageVariable(map?.variables);
  if (!map || !screenId || !language) {
    return { kind: "disabled", hint: TEACH_LANGUAGE_VARIABLE_HINT };
  }
  const matchingTests = Object.values(map.tests ?? {}).filter(
    (test) => testDestinationScreenId(map, test) === screenId,
  );
  const matchingIds = new Set(matchingTests.map((test) => test.id));
  const pairingCombines = Object.values(map.combines ?? {}).filter(
    (combine) =>
      combine.variableIds.includes(language.id) &&
      combine.testIds.some((id) => matchingIds.has(id)),
  );
  const test =
    matchingTests.find((candidate) =>
      pairingCombines.some((combine) => combine.testIds.includes(candidate.id)),
    ) ?? matchingTests[0];
  if (!test) {
    const languageCombine = Object.values(map.combines ?? {}).find((combine) =>
      combine.variableIds.includes(language.id),
    );
    return {
      kind: "open-combine",
      ...(languageCombine ? { combineId: languageCombine.id } : {}),
    };
  }
  const combine =
    pairingCombines.find((candidate) => candidate.testIds.includes(test.id)) ?? pairingCombines[0];
  const known = new Set(language.options.map((option) => option.id));
  const selected = combine?.selected?.[language.id]?.filter((id) => known.has(id));
  if (!selected?.length) {
    return {
      kind: "open-combine",
      ...(combine ? { combineId: combine.id } : {}),
      testId: test.id,
    };
  }
  return {
    kind: "run",
    testId: test.id,
    variableIds: [language.id],
    selected: { [language.id]: selected },
  };
}

export { combineLensName, type CombineLensInput };
