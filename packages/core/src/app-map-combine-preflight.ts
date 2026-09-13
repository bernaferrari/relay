import type {
  AppMap,
  AppMapCombine,
  AppMapCombinePreflight,
  AppMapCombinePreflightIssue,
  RecipeStep,
} from "@relay/protocol";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
import { compileAppMapCombine, compileAppMapTest } from "./map-work.js";
import {
  assessAppMapCombineCellBindings,
  enumerateAppMapCombineCells,
  savedAppMapTargetProfileIdsForTarget,
  unresolvedTargetProfileMessage,
} from "./app-map-combine-cell-prepare.js";
import { synthesizeCombineCellRuntimeProfiles } from "./app-map-combine-from-test.js";
import {
  assertOptionSandwichReady,
  composeOptionRunRecipes,
  defaultOptionMatrixStrategy,
  expectedRecipeScreenshotCount,
  prepareOptionCasePlan,
  type OptionRunSet,
} from "./option-run.js";
import type { Recipe } from "./recipes.js";

function issue(
  code: AppMapCombinePreflightIssue["code"],
  message: string,
): AppMapCombinePreflightIssue {
  return { code, message };
}

function selectedIds(combine: AppMapCombine, variableId: string, available: string[]): string[] {
  if (!Object.hasOwn(combine.selected ?? {}, variableId)) return available;
  const selected = combine.selected?.[variableId] ?? [];
  const availableSet = new Set(available);
  return [...new Set(selected.filter((id) => availableSet.has(id)))];
}

function estimateStepDuration(
  step: RecipeStep,
  graph: Record<string, Recipe>,
  visiting: ReadonlySet<string>,
): number {
  if (step.kind === "sleep") return step.ms;
  if (step.kind === "tap" || step.kind === "key" || step.kind === "swipe") return 700;
  if (step.kind === "screenshot") return 350;
  if (step.kind === "app" || step.kind === "device") return 1_200;
  if (step.kind === "tour") {
    const stops = step.fallbackStops?.length ?? 1;
    return Math.max(2_000, stops * 1_800);
  }
  if (step.kind === "module" || step.kind === "repeat") {
    const nested = graph[step.recipeId];
    if (!nested || visiting.has(nested.id)) return 0;
    const duration = estimateRecipeDuration(nested, graph, new Set(visiting).add(nested.id));
    return step.kind === "repeat" ? duration * step.count : duration;
  }
  if (step.kind === "branch") {
    const branches = [step.thenRecipeId, step.elseRecipeId]
      .map((id) => (id ? graph[id] : undefined))
      .filter((recipe): recipe is Recipe => Boolean(recipe));
    return Math.max(
      0,
      ...branches.map((recipe) =>
        visiting.has(recipe.id)
          ? 0
          : estimateRecipeDuration(recipe, graph, new Set(visiting).add(recipe.id)),
      ),
    );
  }
  return 500;
}

function estimateRecipeDuration(
  recipe: Recipe,
  graph: Record<string, Recipe>,
  visiting: ReadonlySet<string>,
): number {
  return recipe.steps.reduce(
    (total, step) => total + estimateStepDuration(step, graph, visiting),
    0,
  );
}

export async function preflightAppMapCombine(
  map: AppMap,
  combine: AppMapCombine,
  overrides: {
    selected?: Record<string, string[]>;
    strategy?: "zip" | "cartesian" | "pairwise";
    target?: { targetId: string; platform: string };
    defaultTargetProfileId?: string;
  } = {},
  compileOptions: AppMapTestCompileOptions = {},
): Promise<AppMapCombinePreflight> {
  const effectiveCombine: AppMapCombine = {
    ...combine,
    ...(overrides.selected ? { selected: overrides.selected } : {}),
    ...(overrides.strategy ? { strategy: overrides.strategy } : {}),
  };
  const blockers: AppMapCombinePreflightIssue[] = [];
  const warnings: AppMapCombinePreflightIssue[] = [];
  const variables = combine.variableIds.flatMap((id) => {
    const variable = map.variables[id];
    if (!variable) {
      blockers.push(issue("missing-variable", `Variable “${id}” is no longer on this map.`));
      return [];
    }
    return [variable];
  });
  const tests = combine.testIds.flatMap((id) => {
    const test = map.tests[id];
    if (!test) {
      blockers.push(issue("missing-test", `Test “${id}” is no longer on this map.`));
      return [];
    }
    return [test];
  });
  if (!combine.variableIds.length) {
    blockers.push(issue("missing-variable", "Choose at least one Variable."));
  }
  if (!combine.testIds.length) blockers.push(issue("missing-test", "Choose at least one Test."));
  const requiresCellCompilation =
    !compileOptions.runtimeTargetProfile && tests.some((test) => test.family !== undefined);

  const sets: OptionRunSet[] = variables.map((variable) => {
    const available = variable.options.map((option) => option.id);
    const selected = selectedIds(effectiveCombine, variable.id, available);
    if (!selected.length) {
      blockers.push(issue("empty-selection", `Choose at least one ${variable.name} value.`));
    }
    return {
      id: variable.id,
      name: variable.name,
      kind: variable.kind,
      apply: variable.apply,
      options: variable.options,
      restoreId: variable.restoreId,
      screenshotEach: variable.screenshotEach,
    };
  });

  const testPreflights = tests.map((test) => {
    if (requiresCellCompilation && test.family) {
      return { id: test.id, name: test.name, kind: test.kind };
    }
    try {
      const compiled = compileAppMapTest(
        map,
        {
          ...test,
          ...(combine.captures?.[test.id] ? { capture: combine.captures[test.id] } : {}),
        },
        compileOptions,
      );
      const expectedScreenshots = expectedRecipeScreenshotCount(compiled.root, compiled.graph);
      return {
        id: test.id,
        name: test.name,
        kind: test.kind,
        ...(expectedScreenshots !== undefined ? { expectedScreenshots } : {}),
      };
    } catch (error) {
      blockers.push(
        issue(
          "invalid-test",
          error instanceof Error ? error.message : `Test “${test.name}” is not runnable.`,
        ),
      );
      return { id: test.id, name: test.name, kind: test.kind };
    }
  });

  let worlds = 0;
  let expectedScreenshots: number | undefined;
  let estimatedDurationMs: number | undefined;
  if (!blockers.length) {
    try {
      for (const set of sets) assertOptionSandwichReady(set, map);
      const strategy = effectiveCombine.strategy ?? defaultOptionMatrixStrategy(sets.length);
      const matrix = await prepareOptionCasePlan({
        sets,
        selected: effectiveCombine.selected,
        strategy,
        map,
      });
      worlds = matrix.cases.length;
      if (requiresCellCompilation) {
        warnings.push(
          issue(
            "unknown-screenshot-count",
            "Screenshot count depends on each cell's reviewed target route and will be confirmed after binding.",
          ),
        );
      } else {
        const compiled = compileAppMapCombine(map, effectiveCombine, compileOptions);
        const composed = composeOptionRunRecipes({
          body: compiled.root,
          bodyGraph: compiled.graph,
          // Saved tests own their evidence policy. Match the execution route;
          // otherwise a dry run would incorrectly invent legacy before/after
          // screenshots around a capture-free matrix.
          request: {
            sets,
            selected: effectiveCombine.selected,
            strategy,
            map,
            screenshotEach: false,
          },
          batchId: `preflight-${combine.id}`,
        });
        const perWorld = expectedRecipeScreenshotCount(composed.root, composed.graph);
        if (perWorld === undefined) {
          warnings.push(
            issue(
              "unknown-screenshot-count",
              "Screenshot count depends on a live branch or list and will be confirmed during the run.",
            ),
          );
        } else {
          expectedScreenshots = perWorld * worlds;
        }
        estimatedDurationMs =
          estimateRecipeDuration(composed.root, composed.graph, new Set([composed.root.id])) *
          worlds;
      }
    } catch (error) {
      blockers.push(
        issue(
          "compile-failed",
          error instanceof Error ? error.message : "Relay could not compile this Combine.",
        ),
      );
    }
  }

  const checks = worlds * tests.length;
  if (worlds > 50 || checks > 100 || (expectedScreenshots ?? 0) > 500) {
    warnings.push(
      issue(
        "large-run",
        `This is a large run: ${worlds} device runs, ${checks} checks${expectedScreenshots === undefined ? "" : `, and ${expectedScreenshots} screenshots`}.`,
      ),
    );
  }
  const strategy = effectiveCombine.strategy ?? defaultOptionMatrixStrategy(variables.length);
  const variableNames = variables.map((variable) => variable.name);
  const testNames = tests.map((test) => test.name);
  let cells: AppMapCombinePreflight["cells"] = [];
  if (!blockers.length && worlds) {
    try {
      const matrix = await prepareOptionCasePlan({
        sets,
        selected: effectiveCombine.selected,
        strategy,
        map,
      });
      const enumerated = enumerateAppMapCombineCells({
        combine: effectiveCombine,
        tests,
        matrix,
        variableIds: combine.variableIds,
      });
      const assessed = assessAppMapCombineCellBindings({
        cells: enumerated,
        bindings: synthesizeCombineCellRuntimeProfiles({
          cells: enumerated,
          bindings: effectiveCombine.cellRuntimeProfiles ?? [],
          map,
          target: overrides.target,
          explicitProfileId: overrides.defaultTargetProfileId,
        }),
        knownTests: new Set(effectiveCombine.testIds),
        knownValues: Object.fromEntries(
          variables.map((variable) => [
            variable.id,
            new Set(variable.options.map((option) => option.id)),
          ]),
        ),
      });
      cells = assessed.states;
      blockers.push(...assessed.issues);
      if (overrides.target) {
        const target = {
          targetId: overrides.target.targetId,
          platform: overrides.target.platform,
        };
        const named = unresolvedTargetProfileMessage(
          target,
          savedAppMapTargetProfileIdsForTarget(map, target),
        );
        const generic = blockers.findIndex((item) => item.code === "zero-bindings");
        if (generic >= 0) blockers[generic] = issue("zero-bindings", named);
      }
    } catch (error) {
      blockers.push(
        issue(
          "compile-failed",
          error instanceof Error ? error.message : "Relay could not project Combine cells.",
        ),
      );
    }
  }
  return {
    ok: blockers.length === 0,
    appMapId: map.id,
    combineId: combine.id,
    name: combine.name,
    formula: `${variableNames.join(" × ") || "Variable"} × ${testNames.length > 1 ? `(${testNames.join(" + ")})` : testNames[0] || "Test"}`,
    strategy,
    variables: variables.map((variable) => ({
      id: variable.id,
      name: variable.name,
      selectedCount: selectedIds(
        effectiveCombine,
        variable.id,
        variable.options.map((option) => option.id),
      ).length,
      availableCount: variable.options.length,
    })),
    tests: testPreflights,
    worlds,
    checks,
    deviceRuns: worlds,
    ...(expectedScreenshots !== undefined ? { expectedScreenshots } : {}),
    ...(estimatedDurationMs !== undefined ? { estimatedDurationMs } : {}),
    blockers,
    warnings,
    cells,
  };
}
