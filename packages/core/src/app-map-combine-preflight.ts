import type {
  AppMap,
  AppMapCombine,
  AppMapCombinePreflight,
  AppMapCombinePreflightIssue,
} from "@relay/protocol";
import { quoteDeclaredExecutionQueues } from "@relay/protocol";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
import { AppMapTestCompileError } from "./app-map-test-compile-error.js";
import { compileAppMapCombine, compileAppMapTest } from "./map-work.js";
import {
  assessAppMapCombineCellBindings,
  enumerateAppMapCombineCells,
  savedAppMapTargetProfileIdsForTarget,
  unresolvedTargetProfileMessage,
} from "./app-map-combine-cell-prepare.js";
import { bindCompanionCombineCells } from "./app-map-native-companion-combine.js";
import { nativePlatformProfileAlias } from "./app-map-native-companion-compile.js";
import { synthesizeCombineCellRuntimeProfiles } from "./app-map-combine-from-test.js";
import {
  assertOptionSandwichReady,
  composeOptionRunRecipes,
  defaultOptionMatrixStrategy,
  expectedRecipeScreenshotCount,
  prepareOptionCasePlan,
  type OptionRunSet,
} from "./option-run.js";
import {
  assessMutatingRoutineSharing,
  assessSequentialStartingState,
  UnsafeStartingStateError,
} from "./starting-state-routines.js";
import {
  declaredDwellMsFromRecipeGraph,
  estimateRecipeDuration,
} from "./execution-queue-compile.js";

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

export async function preflightAppMapCombine(
  map: AppMap,
  combine: AppMapCombine,
  overrides: {
    selected?: Record<string, string[]>;
    strategy?: "zip" | "cartesian" | "pairwise";
    target?: { targetId: string; platform: string };
    defaultTargetProfileId?: string;
    readAppMap?: (appMapId: string) => Promise<AppMap | null>;
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
  for (const starting of assessSequentialStartingState(map, effectiveCombine.testIds)) {
    blockers.push({
      code: "unsafe-starting-state",
      message: starting.message,
      testId: starting.testId,
    });
  }
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
      if (error instanceof UnsafeStartingStateError) {
        blockers.push({
          code: "unsafe-starting-state",
          message: error.message,
          testId: error.testId,
        });
      } else if (
        error instanceof AppMapTestCompileError &&
        error.code === "unsafe-execution-queue"
      ) {
        blockers.push({
          code: "unsafe-execution-queue",
          message: error.message,
          testId: error.testId,
        });
      } else {
        blockers.push(
          issue(
            "compile-failed",
            error instanceof Error ? error.message : "Relay could not compile this Combine.",
          ),
        );
      }
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
      const alias = overrides.defaultTargetProfileId
        ? nativePlatformProfileAlias(overrides.defaultTargetProfileId)
        : undefined;
      const companionBindings =
        alias && overrides.readAppMap
          ? await bindCompanionCombineCells({
              map,
              cells: enumerated,
              requestedProfileId: overrides.defaultTargetProfileId!,
              ...(overrides.target ? { requestedTarget: overrides.target } : {}),
              readAppMap: overrides.readAppMap,
            })
          : undefined;
      if (companionBindings?.issues.length) blockers.push(...companionBindings.issues);
      const assessed = assessAppMapCombineCellBindings({
        cells: enumerated,
        bindings: companionBindings
          ? companionBindings.bindings
          : synthesizeCombineCellRuntimeProfiles({
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
      const accountVariable = variables.find((variable) => variable.kind === "account");
      const sharingIssues = assessMutatingRoutineSharing(
        map,
        assessed.states.map((cell) => ({
          testId: cell.testId,
          ...(accountVariable && cell.values[accountVariable.id]
            ? { accountId: cell.values[accountVariable.id] }
            : {}),
        })),
      );
      for (const starting of sharingIssues) {
        blockers.push({
          code: "unsafe-starting-state",
          message: starting.message,
          testId: starting.testId,
        });
      }
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
  let queueQuotes: AppMapCombinePreflight["queueQuotes"];
  if (tests.length) {
    const members = tests.flatMap((test) => {
      try {
        const compiled = compileAppMapTest(map, test, compileOptions);
        const queue = compiled.plan.executionQueue;
        if (!queue) return [];
        return [
          {
            executionQueue: queue,
            workMs: estimateRecipeDuration(
              compiled.root,
              compiled.graph,
              new Set([compiled.root.id]),
            ),
            requiredDwellMs: declaredDwellMsFromRecipeGraph(compiled.graph, compiled.root.id),
          },
        ];
      } catch (error) {
        if (error instanceof AppMapTestCompileError && error.code === "unsafe-execution-queue") {
          blockers.push({
            code: "unsafe-execution-queue",
            message: error.message,
            testId: error.testId,
          });
        }
        return [];
      }
    });
    const worldCount = Math.max(1, worlds);
    const quoted = quoteDeclaredExecutionQueues(
      members.flatMap((member) => Array.from({ length: worldCount }, () => member)),
      1,
    );
    if (quoted.length) queueQuotes = quoted;
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
    ...(queueQuotes ? { queueQuotes } : {}),
    blockers,
    warnings,
    cells,
  };
}
