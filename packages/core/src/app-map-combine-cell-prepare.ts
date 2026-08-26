import type {
  AppMap,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
  AppMapCombineCellTargetBinding,
  AppMapCombineCellState,
  AppMapCombinePreflightIssue,
  AppMapCompiledRuntimeTargetProfile,
  AppMapCompiledTest,
  AppMapScenarioTest,
  ExecutionTargetRef,
} from "@relay/protocol";
import {
  appMapCombineCellBindingId,
  appMapCombineCellId,
  canonicalAppMapCombineCellRuntimeProfile,
  canonicalAppMapCombineCellValues,
  sameAppMapCombineCellValues,
} from "./app-map-combine-cell.js";
import {
  createAppMapCombineCellExecutionIntent,
  type AppMapCombineCellExecutionIntent,
} from "./app-map-combine-cell-intent.js";
import {
  composeAppMapCombineCellWrapper,
  declaredCombineCellStaticInputs,
  wrapperInputsForStatic,
  type CombineCellStaticInputs,
  type CombineCellWrapperInputs,
} from "./app-map-combine-cell-wrapper.js";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
import { compileOptionsForVisualSurface } from "./combine-visual-surface.js";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import { compileAppMapTest } from "./map-work.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import {
  assertOptionSandwichReady,
  defaultOptionMatrixStrategy,
  prepareOptionCasePlan,
  type OptionRunSet,
} from "./option-run.js";
import {
  assessAppMapCombineCellTargetBindings,
  localExecutionTargetRef,
  type LocalExecutionTarget,
} from "./app-map-combine-cell-target-binding.js";
import { synthesizeCombineCellRuntimeProfiles } from "./app-map-combine-from-test.js";
import type { Recipe } from "./recipes.js";
import type { PreparedCasePlan } from "./case-plan.js";

export class AppMapCombineCellContractError extends Error {
  readonly code = "APP_MAP_COMBINE_CELL_CONTRACT";
  constructor(
    message: string,
    readonly issues: AppMapCombinePreflightIssue[],
    readonly cells: AppMapCombineCellState[],
  ) {
    super(message);
    this.name = "AppMapCombineCellContractError";
  }
}

export type PreparedAppMapCombineCell = {
  cellId: string;
  testId: string;
  testName: string;
  values: Record<string, string>;
  worldLabel: string;
  worldIndex: number;
  targetProfileId: string;
  /** Audit provenance of `targetProfileId`: bound per-cell, or inherited from
   * the only saved profile that matches this cell's concrete target. */
  targetProfileIdSource: "explicit" | "inherited";
  /** Immutable location that this cell was explicitly bound to before queueing. */
  executionTarget: LocalExecutionTarget;
  selectedRuntimeTargetProfile: AppMapCompiledRuntimeTargetProfile;
  plan: AppMapCompiledTest;
  staticInputs: CombineCellStaticInputs;
  wrapperInputs: CombineCellWrapperInputs;
  childIntent: ReturnType<typeof createAppMapTestExecutionIntent>;
  outerIntent: AppMapCombineCellExecutionIntent;
  recipeSnapshot: Recipe;
  recipeGraph: Record<string, Recipe>;
};

export type PreparedAppMapCombine = {
  cells: PreparedAppMapCombineCell[];
  selectedCellIds: string[];
  selectedCells: PreparedAppMapCombineCell[];
  matrix: PreparedCasePlan;
  cellStates: AppMapCombineCellState[];
  sets: OptionRunSet[];
};

function issue(
  code: AppMapCombinePreflightIssue["code"],
  message: string,
  extra: Partial<AppMapCombinePreflightIssue> = {},
): AppMapCombinePreflightIssue {
  return { code, message, ...extra };
}

function selectedOptionIds(
  combine: AppMapCombine,
  variableId: string,
  available: string[],
  overrides?: Record<string, string[]>,
): string[] {
  const source = overrides ?? combine.selected;
  if (!Object.hasOwn(source ?? {}, variableId)) return available;
  const selected = source?.[variableId] ?? [];
  const availableSet = new Set(available);
  return [...new Set(selected.filter((id) => availableSet.has(id)))];
}

export function optionSetsForAppMapCombine(map: AppMap, combine: AppMapCombine): OptionRunSet[] {
  return combine.variableIds.map((id) => {
    const set = map.variables?.[id];
    if (!set)
      throw new AppMapCombineCellContractError(
        `Variable ${id} is no longer on this map.`,
        [issue("missing-variable", `Variable “${id}” is no longer on this map.`)],
        [],
      );
    return {
      id: set.id,
      name: set.name,
      kind: set.kind,
      apply: set.apply,
      options: set.options,
      restoreId: set.restoreId,
      screenshotEach: set.screenshotEach,
    };
  });
}

/** Deduped saved runtime-profile ids that bind to one concrete target, in
 * stable message order. These are the only ids a failed binding can accept,
 * so every recovery message lists them instead of hiding them in raw map data. */
export function savedAppMapTargetProfileIdsForTarget(
  map: AppMap,
  target: { targetId: string; platform: string },
): string[] {
  const ids = new Set(
    Object.values(map.screenVariants ?? {})
      .map((variant) => variant.targetProfile)
      .filter(
        (profile) =>
          profile.id &&
          profile.targetId === target.targetId &&
          profile.platform === target.platform,
      )
      .map((profile) => profile.id),
  );
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function targetProfileLabel(target: { targetId: string; platform: string }): string {
  return `${target.platform}:${target.targetId}`;
}

function unresolvedTargetProfileMessage(
  target: { targetId: string; platform: string },
  candidates: string[],
): string {
  return candidates.length
    ? `Multiple saved runtime profiles bind to ${targetProfileLabel(target)}: ${candidates.join(", ")}. Bind an explicit targetProfileId.`
    : `No saved runtime profile for target ${targetProfileLabel(target)} — capture a screen on this target first.`;
}

function savedTargetProfileHint(
  map: AppMap,
  target: { targetId: string; platform: string },
): string {
  const candidates = savedAppMapTargetProfileIdsForTarget(map, target);
  return candidates.length
    ? ` Saved runtime profiles for ${targetProfileLabel(target)}: ${candidates.join(", ")}.`
    : ` No saved runtime profile for target ${targetProfileLabel(target)} — capture a screen on this target first.`;
}

export function resolveSavedAppMapRuntimeTargetProfile(input: {
  map: AppMap;
  /** Explicit saved profile id. When omitted or blank, the single saved
   * profile that binds to `target` is inherited; ambiguity stays an error. */
  targetProfileId?: string;
  target: { targetId: string; platform: "android" | "ios" | "browser" };
}): AppMapCompiledRuntimeTargetProfile {
  const targetProfileId = input.targetProfileId?.trim() ?? "";
  if (!targetProfileId) {
    const candidates = savedAppMapTargetProfileIdsForTarget(input.map, input.target);
    if (candidates.length !== 1) {
      const message = unresolvedTargetProfileMessage(input.target, candidates);
      throw new AppMapCombineCellContractError(
        message,
        [issue("missing-binding", message)],
        [],
      );
    }
    return resolveSavedAppMapRuntimeTargetProfile({
      map: input.map,
      targetProfileId: candidates[0]!,
      target: input.target,
    });
  }
  const profiles = Object.values(input.map.screenVariants)
    .map((variant) => variant.targetProfile)
    .filter((profile) => profile.id === targetProfileId);
  if (!profiles.length) {
    const message = `Target profile ${targetProfileId} is not saved in this App Map.${savedTargetProfileHint(input.map, input.target)}`;
    throw new AppMapCombineCellContractError(
      message,
      [
        issue("mismatched-binding", message, {
          targetProfileId,
        }),
      ],
      [],
    );
  }
  const mismatched = profiles.filter(
    (profile) =>
      profile.targetId !== input.target.targetId || profile.platform !== input.target.platform,
  );
  if (mismatched.length) {
    const message = `Target profile ${targetProfileId} does not bind to ${input.target.platform}:${input.target.targetId}.${savedTargetProfileHint(input.map, input.target)}`;
    throw new AppMapCombineCellContractError(
      message,
      [
        issue("mismatched-binding", message, {
          targetProfileId,
        }),
      ],
      [],
    );
  }
  const identity = (profile: (typeof profiles)[number]) =>
    [
      profile.id,
      profile.targetId,
      profile.platform,
      profile.viewport ? `${profile.viewport.width}x${profile.viewport.height}` : "",
    ].join("\u0000");
  if (new Set(profiles.map(identity)).size !== 1) {
    throw new AppMapCombineCellContractError(
      `Target profile ${targetProfileId} has conflicting saved identities`,
      [
        issue(
          "mismatched-binding",
          `Target profile ${targetProfileId} has conflicting saved identities`,
          {
            targetProfileId,
          },
        ),
      ],
      [],
    );
  }
  const profile = profiles[0]!;
  return {
    id: profile.id,
    targetId: profile.targetId,
    platform: profile.platform,
    ...(profile.viewport ? { viewport: structuredClone(profile.viewport) } : {}),
  };
}

export type AppMapCombineEnumeratedCell = {
  cellId: string;
  testId: string;
  testName: string;
  values: Record<string, string>;
  worldLabel: string;
  worldIndex: number;
};

export function enumerateAppMapCombineCells(input: {
  combine: AppMapCombine;
  tests: AppMapScenarioTest[];
  matrix: PreparedCasePlan;
  variableIds: readonly string[];
}): AppMapCombineEnumeratedCell[] {
  const cells = [];
  for (const world of input.matrix.cases) {
    const values = canonicalAppMapCombineCellValues(
      Object.fromEntries(input.variableIds.map((id) => [id, world.values[id] ?? ""])),
    );
    if (Object.values(values).some((value) => !value)) {
      throw new AppMapCombineCellContractError(
        "A Combine world is missing a Variable value.",
        [issue("empty-selection", "A Combine world is missing a Variable value.")],
        [],
      );
    }
    for (const test of input.tests) {
      cells.push({
        cellId: appMapCombineCellId(test.id, values),
        testId: test.id,
        testName: test.name,
        values,
        worldLabel: world.name || `world-${world.index + 1}`,
        worldIndex: world.index,
      });
    }
  }
  return cells;
}

export function assessAppMapCombineCellBindings(input: {
  cells: Array<{
    cellId: string;
    testId: string;
    testName: string;
    values: Record<string, string>;
    worldLabel: string;
  }>;
  bindings: AppMapCombineCellRuntimeProfile[];
  /** Bindings may cover a larger saved grid. Unknown Test/value pairs are foreign. */
  knownTests?: ReadonlySet<string>;
  knownValues?: Record<string, ReadonlySet<string>>;
  rejectUnselectedBindings?: boolean;
}): {
  issues: AppMapCombinePreflightIssue[];
  states: AppMapCombineCellState[];
  byCellId: Map<string, AppMapCombineCellRuntimeProfile>;
} {
  const issues: AppMapCombinePreflightIssue[] = [];
  const byCellId = new Map<string, AppMapCombineCellRuntimeProfile>();
  const seenBindings = new Set<string>();
  const required = new Set(input.cells.map((cell) => cell.cellId));
  if (!input.bindings.length && input.cells.length) {
    issues.push(
      issue("zero-bindings", "Bind a saved runtime profile to every selected Combine cell."),
    );
  }
  for (const raw of input.bindings) {
    const binding = canonicalAppMapCombineCellRuntimeProfile(raw);
    const cellId = appMapCombineCellBindingId(binding);
    if (seenBindings.has(cellId)) {
      issues.push(
        issue("duplicate-binding", `Cell ${cellId} has more than one runtime profile binding.`, {
          cellId,
          testId: binding.testId,
          values: binding.values,
          targetProfileId: binding.targetProfileId,
        }),
      );
      continue;
    }
    seenBindings.add(cellId);
    const unknownTest = input.knownTests && !input.knownTests.has(binding.testId);
    const unknownValue = Object.entries(binding.values).some(([variableId, valueId]) => {
      const allowed = input.knownValues?.[variableId];
      return allowed ? !allowed.has(valueId) : Boolean(input.knownValues);
    });
    if (unknownTest || unknownValue) {
      issues.push(
        issue("foreign-binding", `Binding for ${binding.testId} is not a selected Combine cell.`, {
          cellId,
          testId: binding.testId,
          values: binding.values,
          targetProfileId: binding.targetProfileId,
        }),
      );
      continue;
    }
    const expected = input.cells.find((cell) => cell.cellId === cellId);
    if (!expected) {
      if (input.rejectUnselectedBindings) {
        issues.push(
          issue(
            "extra-binding",
            `Binding for ${binding.testId} is outside the selected Combine cells.`,
            {
              cellId,
              testId: binding.testId,
              values: binding.values,
              targetProfileId: binding.targetProfileId,
            },
          ),
        );
      }
      continue;
    }
    if (
      expected.testId !== binding.testId ||
      !sameAppMapCombineCellValues(expected.values, binding.values)
    ) {
      issues.push(
        issue("mismatched-binding", `Binding for ${cellId} does not match its Test and values.`, {
          cellId,
          testId: binding.testId,
          values: binding.values,
          targetProfileId: binding.targetProfileId,
        }),
      );
      continue;
    }
    if (!binding.targetProfileId.trim()) {
      issues.push(
        issue("missing-binding", `Cell ${cellId} is missing a targetProfileId.`, {
          cellId,
          testId: binding.testId,
          values: binding.values,
        }),
      );
      continue;
    }
    byCellId.set(cellId, binding);
  }
  const states: AppMapCombineCellState[] = input.cells.map((cell) => {
    const binding = byCellId.get(cell.cellId);
    if (!binding) {
      issues.push(
        issue(
          "missing-binding",
          `Bind a runtime profile to ${cell.testName} · ${cell.worldLabel}.`,
          {
            cellId: cell.cellId,
            testId: cell.testId,
            values: cell.values,
          },
        ),
      );
      return {
        cellId: cell.cellId,
        testId: cell.testId,
        testName: cell.testName,
        values: cell.values,
        worldLabel: cell.worldLabel,
        binding: "missing" as const,
        message: "No saved runtime profile",
      };
    }
    return {
      cellId: cell.cellId,
      testId: cell.testId,
      testName: cell.testName,
      values: cell.values,
      worldLabel: cell.worldLabel,
      targetProfileId: binding.targetProfileId,
      binding: "bound" as const,
    };
  });
  if (input.rejectUnselectedBindings && seenBindings.size > required.size) {
    issues.push(
      issue(
        "extra-binding",
        "This Combine has runtime profile bindings outside the selected cells.",
      ),
    );
  }
  return { issues, states, byCellId };
}

/** Fill in per-cell runtime profiles that a concrete target already proves.
 * A cell with an explicit binding keeps it; an unbound cell whose concrete
 * target has exactly one saved profile inherits it, and any ambiguity fails
 * closed with the candidate ids named in the message. */
function completeCellRuntimeProfileBindings(input: {
  map: AppMap;
  cells: readonly AppMapCombineEnumeratedCell[];
  supplied: readonly AppMapCombineCellRuntimeProfile[];
  synthesized: readonly AppMapCombineCellRuntimeProfile[];
  targetByCellId: ReadonlyMap<string, LocalExecutionTarget>;
  fallbackTarget?: LocalExecutionTarget;
}): {
  bindings: AppMapCombineCellRuntimeProfile[];
  inheritedProfileByCellId: Map<string, string>;
  issues: AppMapCombinePreflightIssue[];
  unresolvedCellIds: Set<string>;
} {
  const bindings = [...input.synthesized];
  const inheritedProfileByCellId = new Map<string, string>();
  const issues: AppMapCombinePreflightIssue[] = [];
  const unresolvedCellIds = new Set<string>();
  for (const cell of input.cells) {
    const bound = bindings.find(
      (binding) =>
        binding.testId === cell.testId &&
        sameAppMapCombineCellValues(binding.values, cell.values),
    );
    if (bound) {
      const explicit = input.supplied.some(
        (binding) =>
          binding.testId === cell.testId &&
          sameAppMapCombineCellValues(binding.values, cell.values),
      );
      if (!explicit && bound.targetProfileId.trim()) {
        inheritedProfileByCellId.set(cell.cellId, bound.targetProfileId);
      }
      continue;
    }
    const cellTarget = input.targetByCellId.get(cell.cellId) ?? input.fallbackTarget;
    if (!cellTarget) continue;
    const candidates = savedAppMapTargetProfileIdsForTarget(input.map, {
      targetId: cellTarget.targetId,
      platform: cellTarget.platform,
    });
    if (candidates.length === 1) {
      bindings.push({
        testId: cell.testId,
        values: { ...cell.values },
        targetProfileId: candidates[0]!,
      });
      inheritedProfileByCellId.set(cell.cellId, candidates[0]!);
      continue;
    }
    unresolvedCellIds.add(cell.cellId);
    const message =
      candidates.length > 1
        ? `Multiple saved runtime profiles bind to ${targetProfileLabel(cellTarget)} for ${cell.testName} · ${cell.worldLabel}: ${candidates.join(", ")}. Bind an explicit targetProfileId.`
        : `No saved runtime profile for target ${targetProfileLabel(cellTarget)} — capture a screen on this target first.`;
    issues.push(
      issue("missing-binding", message, {
        cellId: cell.cellId,
        testId: cell.testId,
        values: cell.values,
      }),
    );
  }
  return { bindings, inheritedProfileByCellId, issues, unresolvedCellIds };
}

async function prepareOneCell(input: {
  map: AppMap;
  combine: AppMapCombine;
  cell: AppMapCombineEnumeratedCell;
  binding: AppMapCombineCellRuntimeProfile;
  sets: OptionRunSet[];
  worldValues: Record<string, string>;
  target: LocalExecutionTarget;
  /** Provenance of the binding's profile id, recorded for audit. */
  targetProfileIdSource: "explicit" | "inherited";
  compileOptions: AppMapTestCompileOptions;
}): Promise<PreparedAppMapCombineCell> {
  const test = input.map.tests[input.cell.testId] as AppMapScenarioTest | undefined;
  if (!test) {
    throw new AppMapCombineCellContractError(
      `Test ${input.cell.testId} is no longer on this map.`,
      [
        issue("missing-test", `Test “${input.cell.testId}” is no longer on this map.`, {
          cellId: input.cell.cellId,
          testId: input.cell.testId,
        }),
      ],
      [],
    );
  }
  const selectedRuntimeTargetProfile = resolveSavedAppMapRuntimeTargetProfile({
    map: input.map,
    targetProfileId: input.binding.targetProfileId,
    target: { targetId: input.target.targetId, platform: input.target.platform },
  });
  const effectiveTest = {
    ...test,
    ...(input.combine.captures?.[test.id] ? { capture: input.combine.captures[test.id] } : {}),
  };
  const compiled = compileAppMapTest(
    input.map,
    effectiveTest,
    compileOptionsForVisualSurface(effectiveTest, input.compileOptions),
  );
  const plan = {
    ...compiled.plan,
    runtimeTargetProfile: structuredClone(selectedRuntimeTargetProfile),
  };
  const preflight = preflightCompiledAppMapTestOffline(
    plan,
    await loadFrozenRawAccessibilityEvidence(plan),
    { targetProfileId: selectedRuntimeTargetProfile.id },
  );
  if (preflight.summary.blockers) {
    throw new AppMapCombineCellContractError(
      `Offline preflight blocked ${input.cell.testName} · ${input.cell.worldLabel}`,
      [
        issue(
          "compile-failed",
          `Offline preflight blocked ${input.cell.testName} · ${input.cell.worldLabel}`,
          {
            cellId: input.cell.cellId,
            testId: input.cell.testId,
            values: input.cell.values,
            targetProfileId: selectedRuntimeTargetProfile.id,
          },
        ),
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
  const childIntent = createAppMapTestExecutionIntent({ plan, recipeGraph, preflight });
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
  });
  return {
    cellId: input.cell.cellId,
    testId: input.cell.testId,
    testName: input.cell.testName,
    values: input.cell.values,
    worldLabel: input.cell.worldLabel,
    worldIndex: input.cell.worldIndex,
    targetProfileId: selectedRuntimeTargetProfile.id,
    targetProfileIdSource: input.targetProfileIdSource,
    executionTarget: structuredClone(input.target),
    selectedRuntimeTargetProfile,
    plan,
    staticInputs,
    wrapperInputs,
    childIntent,
    outerIntent,
    recipeSnapshot: wrapper.root,
    recipeGraph: wrapper.graph,
  };
}

export async function prepareAppMapCombineCells(input: {
  map: AppMap;
  combine: AppMapCombine;
  selected?: Record<string, string[]>;
  strategy?: "zip" | "cartesian" | "pairwise";
  cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
  /** Explicit execution target per Test × world cell. Required for multi-target runs. */
  cellTargetBindings?: AppMapCombineCellTargetBinding[];
  selectedCellIds?: string[];
  rejectUnselectedBindings?: boolean;
  /** Backward-compatible single local target. It is expanded to every cell. */
  target?: { targetId: string; platform: "android" | "ios" | "browser" };
  /** Optional explicit profile used when synthesizing missing cell bindings. */
  defaultTargetProfileId?: string;
  compileOptions?: AppMapTestCompileOptions;
}): Promise<PreparedAppMapCombine> {
  const tests = input.combine.testIds.map((id) => {
    const test = input.map.tests?.[id];
    if (!test) {
      throw new AppMapCombineCellContractError(
        `Test ${id} is no longer on this map.`,
        [issue("missing-test", `Test “${id}” is no longer on this map.`, { testId: id })],
        [],
      );
    }
    return test;
  });
  const sets = optionSetsForAppMapCombine(input.map, input.combine);
  for (const set of sets) assertOptionSandwichReady(set, input.map);
  const selected = input.selected ?? input.combine.selected;
  for (const set of sets) {
    if (
      !selectedOptionIds(
        input.combine,
        set.id,
        set.options.map((option) => option.id),
        selected,
      ).length
    ) {
      throw new AppMapCombineCellContractError(
        `Choose at least one ${set.name} value.`,
        [issue("empty-selection", `Choose at least one ${set.name} value.`)],
        [],
      );
    }
  }
  const strategy =
    input.strategy ?? input.combine.strategy ?? defaultOptionMatrixStrategy(sets.length);
  const matrix = await prepareOptionCasePlan({
    sets,
    selected,
    strategy,
    map: input.map,
  });
  const cells = enumerateAppMapCombineCells({
    combine: input.combine,
    tests,
    matrix,
    variableIds: input.combine.variableIds,
  });
  const suppliedBindings = input.cellRuntimeProfiles ?? input.combine.cellRuntimeProfiles ?? [];
  const synthesized = synthesizeCombineCellRuntimeProfiles({
    cells,
    bindings: suppliedBindings,
    map: input.map,
    target: input.target,
    explicitProfileId: input.defaultTargetProfileId,
  });
  const fallbackTarget = input.target ? localExecutionTargetRef(input.target) : undefined;
  const assessedTargets = assessAppMapCombineCellTargetBindings({
    cells,
    bindings: input.cellTargetBindings,
    fallbackTarget,
    knownTests: new Set(input.combine.testIds),
    knownValues: Object.fromEntries(
      sets.map((set) => [set.id, new Set(set.options.map((option) => option.id))]),
    ),
    rejectUnselectedBindings: input.rejectUnselectedBindings === true,
  });
  const completed = completeCellRuntimeProfileBindings({
    map: input.map,
    cells,
    supplied: suppliedBindings,
    synthesized,
    targetByCellId: assessedTargets.byCellId,
    fallbackTarget,
  });
  const assessed = assessAppMapCombineCellBindings({
    cells,
    bindings: completed.bindings,
    knownTests: new Set(input.combine.testIds),
    knownValues: Object.fromEntries(
      sets.map((set) => [set.id, new Set(set.options.map((option) => option.id))]),
    ),
    rejectUnselectedBindings: input.rejectUnselectedBindings === true,
  });
  const cellStates = assessed.states.map((state) => {
    const target = assessedTargets.byCellId.get(state.cellId);
    return target ? { ...state, target: structuredClone(target) } : state;
  });
  const issues = [
    ...completed.issues,
    ...assessed.issues.filter(
      (item) =>
        !(item.code === "zero-bindings" && completed.issues.length) &&
        !(
          item.code === "missing-binding" &&
          item.cellId !== undefined &&
          completed.unresolvedCellIds.has(item.cellId)
        ),
    ),
    ...assessedTargets.issues,
  ];
  if (issues.length) {
    throw new AppMapCombineCellContractError(
      issues[0]?.message ?? "Combine cells are missing explicit runtime profile bindings.",
      issues,
      cellStates,
    );
  }
  const requestedSelected = input.selectedCellIds?.map((id) => id.trim()).filter(Boolean);
  const known = new Set(cells.map((cell) => cell.cellId));
  if (requestedSelected) {
    const unknown = requestedSelected.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new AppMapCombineCellContractError(
        "selectedCellIds includes a cell that is not in this Combine.",
        [issue("foreign-binding", `Unknown selected cell ${unknown[0]}.`, { cellId: unknown[0] })],
        cellStates,
      );
    }
  }
  const selectedCellIds = requestedSelected?.length
    ? [...new Set(requestedSelected)]
    : cells.map((cell) => cell.cellId);
  const prepared: PreparedAppMapCombineCell[] = [];
  for (const cell of cells) {
    const world = matrix.cases[cell.worldIndex];
    if (!world) {
      throw new AppMapCombineCellContractError(
        `Combine world ${cell.worldIndex} is missing.`,
        [
          issue("compile-failed", `Combine world ${cell.worldIndex} is missing.`, {
            cellId: cell.cellId,
          }),
        ],
        cellStates,
      );
    }
    const preparedCell = await prepareOneCell({
      map: input.map,
      combine: input.combine,
      cell,
      binding: assessed.byCellId.get(cell.cellId)!,
      sets,
      worldValues: world.values,
      target: assessedTargets.byCellId.get(cell.cellId)!,
      targetProfileIdSource: completed.inheritedProfileByCellId.has(cell.cellId)
        ? "inherited"
        : "explicit",
      compileOptions: input.compileOptions ?? {},
    });
    prepared.push({
      ...preparedCell,
      worldLabel: cell.worldLabel,
    });
  }
  const byId = new Map(prepared.map((cell) => [cell.cellId, cell]));
  return {
    cells: prepared,
    selectedCellIds,
    selectedCells: selectedCellIds.map((id) => byId.get(id)!),
    matrix,
    cellStates: prepared.map((cell) => ({
      cellId: cell.cellId,
      testId: cell.testId,
      testName: cell.testName,
      values: cell.values,
      worldLabel: cell.worldLabel,
      targetProfileId: cell.targetProfileId,
      target: structuredClone(cell.executionTarget) as ExecutionTargetRef,
      binding: "bound",
      preflight: "ready",
    })),
    sets,
  };
}
