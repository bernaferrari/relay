import type {
  AppMap,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
  AppMapCompiledRuntimeTargetProfile,
  AppMapNativeCompanionCompile,
  AppMapScenarioTest,
} from "@relay/protocol";
import type {
  AppMapCombineEnumeratedCell,
  PreparedAppMapCombineCell,
} from "./app-map-combine-cell-prepare.js";
import {
  AppMapCombineCellContractError,
  resolveSavedAppMapRuntimeTargetProfile,
} from "./app-map-combine-runtime-profile.js";
import type { LocalExecutionTarget } from "./app-map-combine-cell-target-binding.js";
import { resolveCombineCellCompanion } from "./app-map-native-companion-combine.js";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
import { compileOptionsForVisualSurface } from "./combine-visual-surface.js";
import { compileAppMapTest } from "./map-work.js";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import { createAppMapCombineCellExecutionIntent } from "./app-map-combine-cell-intent.js";
import {
  composeAppMapCombineCellWrapper,
  declaredCombineCellStaticInputs,
  wrapperInputsForStatic,
} from "./app-map-combine-cell-wrapper.js";
import { selectedCombineDataRows } from "./app-map-combine-cell-inputs.js";
import type { OptionRunSet } from "./option-run.js";

export type ResolvedAppMapCombineCell = {
  executionMap: AppMap;
  effectiveTest: AppMapScenarioTest;
  executionTarget: LocalExecutionTarget;
  selectedRuntimeTargetProfile: AppMapCompiledRuntimeTargetProfile;
  nativeCompanion?: AppMapNativeCompanionCompile;
  sameMap: boolean;
};

export async function resolveAppMapCombineCell(input: {
  map: AppMap;
  combine: AppMapCombine;
  cell: AppMapCombineEnumeratedCell;
  binding: AppMapCombineCellRuntimeProfile;
  target: LocalExecutionTarget;
  readAppMap?: (appMapId: string) => Promise<AppMap | null>;
}): Promise<ResolvedAppMapCombineCell> {
  const test = input.map.tests[input.cell.testId] as AppMapScenarioTest | undefined;
  if (!test) {
    throw new AppMapCombineCellContractError(
      `Test ${input.cell.testId} is no longer on this map.`,
      [
        {
          code: "missing-test",
          message: `Test “${input.cell.testId}” is no longer on this map.`,
          cellId: input.cell.cellId,
          testId: input.cell.testId,
        },
      ],
      [],
    );
  }
  const companion = await resolveCombineCellCompanion({
    map: input.map,
    test,
    requestedProfileId: input.binding.targetProfileId,
    requestedTarget: input.target,
    ...(input.readAppMap ? { readAppMap: input.readAppMap } : {}),
  });
  const executionMap = companion?.map ?? input.map;
  const executionTest = companion?.test ?? test;
  const executionTarget = companion?.executionTarget ?? input.target;
  const selectedRuntimeTargetProfile =
    companion?.runtimeTargetProfile ??
    resolveSavedAppMapRuntimeTargetProfile({
      map: input.map,
      targetProfileId: input.binding.targetProfileId,
      target: { targetId: input.target.targetId, platform: input.target.platform },
    });
  const sameMap = executionMap.id === input.map.id;
  const effectiveTest = {
    ...executionTest,
    ...(sameMap && input.combine.captures?.[test.id]
      ? { capture: input.combine.captures[test.id] }
      : {}),
  };
  return {
    executionMap,
    effectiveTest,
    executionTarget,
    selectedRuntimeTargetProfile,
    sameMap,
    ...(companion?.nativeCompanion ? { nativeCompanion: companion.nativeCompanion } : {}),
  };
}

export async function compileAppMapCombineCell(
  input: {
    map: AppMap;
    cell: AppMapCombineEnumeratedCell;
    sets: OptionRunSet[];
    worldValues: Record<string, string>;
    targetProfileIdSource: "explicit" | "inherited";
    compileOptions: AppMapTestCompileOptions;
    laneId?: string;
  },
  subject: ResolvedAppMapCombineCell,
): Promise<PreparedAppMapCombineCell> {
  const {
    executionMap,
    effectiveTest,
    selectedRuntimeTargetProfile,
    executionTarget,
    nativeCompanion,
    sameMap,
  } = subject;
  const compiled = compileAppMapTest(
    executionMap,
    effectiveTest,
    compileOptionsForVisualSurface(effectiveTest, {
      ...(sameMap
        ? input.compileOptions
        : input.compileOptions.startupMode
          ? { startupMode: input.compileOptions.startupMode }
          : {}),
      runtimeTargetProfile: selectedRuntimeTargetProfile,
    }),
  );
  const plan = compiled.plan;
  const preflight = preflightCompiledAppMapTestOffline(
    plan,
    await loadFrozenRawAccessibilityEvidence(plan),
    { targetProfileId: selectedRuntimeTargetProfile.id },
  );
  if (preflight.summary.blockers) {
    throw new AppMapCombineCellContractError(
      `Offline preflight blocked ${input.cell.testName} · ${input.cell.worldLabel}`,
      [
        {
          code: "compile-failed",
          message: `Offline preflight blocked ${input.cell.testName} · ${input.cell.worldLabel}`,
          cellId: input.cell.cellId,
          testId: input.cell.testId,
          values: input.cell.values,
          targetProfileId: selectedRuntimeTargetProfile.id,
        },
      ],
      [
        {
          cellId: input.cell.cellId,
          testId: input.cell.testId,
          testName: input.cell.testName,
          values: input.cell.values,
          worldLabel: input.cell.worldLabel,
          targetProfileId: selectedRuntimeTargetProfile.id,
          binding: "bound",
          preflight: "blocked",
          message: "Offline preflight blocked this cell",
        },
      ],
    );
  }
  const recipeGraph = Object.fromEntries(
    Object.values(compiled.graph).map((recipe) => [recipe.id, structuredClone(recipe)]),
  );
  const laneId = input.laneId?.trim();
  const childIntent = createAppMapTestExecutionIntent({
    plan,
    recipeGraph,
    preflight,
    ...(laneId ? { laneId } : {}),
  });
  const staticInputs = declaredCombineCellStaticInputs(input.sets, input.worldValues);
  const wrapper = composeAppMapCombineCellWrapper({
    cellId: input.cell.cellId,
    childRootId: childIntent.sourcePlan.rootRecipeId,
    childGraph: childIntent.recipeGraph,
    sets: input.sets,
    map: input.map,
    at: 0,
  });
  const wrapperInputs = wrapperInputsForStatic(wrapper.prefixes, staticInputs);
  const outerIntent = createAppMapCombineCellExecutionIntent({
    cellId: input.cell.cellId,
    testId: input.cell.testId,
    values: input.cell.values,
    selectedRuntimeTargetProfile,
    child: childIntent,
    wrapperRoot: wrapper.root,
    recipeGraph: wrapper.graph,
    staticInputs,
    ...(nativeCompanion ? { nativeCompanion } : {}),
  });
  return {
    cellId: input.cell.cellId,
    testId: input.cell.testId,
    testName: input.cell.testName,
    values: input.cell.values,
    selectedDataRows: selectedCombineDataRows(input.sets, input.cell.values),
    worldLabel: input.cell.worldLabel,
    worldIndex: input.cell.worldIndex,
    targetProfileId: selectedRuntimeTargetProfile.id,
    targetProfileIdSource: input.targetProfileIdSource,
    executionTarget: structuredClone(executionTarget),
    selectedRuntimeTargetProfile,
    ...(nativeCompanion ? { nativeCompanion } : {}),
    plan,
    staticInputs,
    wrapperInputs,
    childIntent,
    outerIntent,
    recipeSnapshot: wrapper.root,
    recipeGraph: wrapper.graph,
  };
}
