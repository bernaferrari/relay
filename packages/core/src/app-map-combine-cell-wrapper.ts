import type { AppMap, RecipeStep, VariableRow } from "@relay/protocol";
import { appMapCombineCellVariablePrefix } from "./app-map-combine-cell.js";
import {
  appLocaleRecipeSteps,
  appLocaleShouldRelaunch,
  assertOptionSandwichReady,
  navStepsToRecipe,
  type OptionRunSet,
} from "./option-run.js";
import type { Recipe } from "./recipes.js";
import {
  appLocaleExpectedLabels,
  stayAppLocaleDestinationCheck,
} from "./stay-app-locale-destination.js";

export { stayAppLocaleDestinationCheck };

const NONE = "-";

function companion(value: string | undefined): string {
  return value?.trim() || NONE;
}

function rowFor(set: OptionRunSet, id: string): VariableRow {
  return set.options.find((row) => row.id === id) ?? { id };
}

function tapHelpers(prefix: string, at: number): Record<string, Recipe> {
  const tapIdentifier: Recipe = {
    id: `__opt_${prefix}_tap_identifier`,
    title: `Tap ${prefix} by identifier`,
    source: "custom",
    steps: [{ kind: "tap", target: { identifier: `{{${prefix}_identifier}}` } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapLabel: Recipe = {
    id: `__opt_${prefix}_tap_label`,
    title: `Tap ${prefix} by label`,
    source: "custom",
    steps: [{ kind: "tap", target: { label: `{{${prefix}_label}}` } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapText: Recipe = {
    id: `__opt_${prefix}_tap_text`,
    title: `Tap ${prefix} by text`,
    source: "custom",
    steps: [{ kind: "tap", target: { text: `{{${prefix}_text}}` } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapLabelOrText: Recipe = {
    id: `__opt_${prefix}_tap_label_or_text`,
    title: `Tap ${prefix} by label or text`,
    source: "custom",
    steps: [
      {
        kind: "branch",
        input: `{{${prefix}_label}}`,
        operator: "not-equals",
        expected: NONE,
        thenRecipeId: tapLabel.id,
        elseRecipeId: tapText.id,
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  return {
    [tapIdentifier.id]: tapIdentifier,
    [tapLabel.id]: tapLabel,
    [tapText.id]: tapText,
    [tapLabelOrText.id]: tapLabelOrText,
  };
}

function selectSteps(prefix: string): RecipeStep[] {
  return [
    {
      kind: "branch",
      input: `{{${prefix}_identifier}}`,
      operator: "not-equals",
      expected: NONE,
      thenRecipeId: `__opt_${prefix}_tap_identifier`,
      elseRecipeId: `__opt_${prefix}_tap_label_or_text`,
    },
    { kind: "sleep", ms: 900 },
  ];
}

function targetsForOptionRow(row: VariableRow): import("@relay/protocol").StepTarget[] {
  const candidates: import("@relay/protocol").StepTarget[] = [];
  const identifier = row.identifier?.trim();
  const label = row.label?.trim();
  const text = row.text?.trim();
  if (identifier) candidates.push({ identifier });
  if (label) candidates.push({ label });
  if (text) candidates.push({ text });
  return candidates;
}

function restoreListSteps(set: OptionRunSet): RecipeStep[] {
  const restoreId = set.restoreId?.trim();
  if (!restoreId) return [];
  const row = set.options.find((option) => option.id === restoreId);
  if (!row) {
    throw new Error(`variable “${set.name}” has no restore option ${restoreId}`);
  }
  const [target, ...fallbackTargets] = targetsForOptionRow(row);
  if (!target) {
    throw new Error(
      `restore option “${restoreId}” for variable “${set.name}” needs an identifier, label, or text`,
    );
  }
  return [
    {
      kind: "tap",
      target,
      ...(fallbackTargets.length ? { fallbackTargets } : {}),
    },
    { kind: "sleep", ms: 900 },
  ];
}

export type CombineCellStaticInputs = {
  values: Record<string, string>;
  companions: Record<string, { identifier: string; label: string; text: string }>;
};

export type CombineCellWrapperInputs = Record<string, string>;

export function declaredCombineCellStaticInputs(
  sets: readonly OptionRunSet[],
  worldValues: Record<string, string>,
): CombineCellStaticInputs {
  const values: Record<string, string> = {};
  const companions: Record<string, { identifier: string; label: string; text: string }> = {};
  for (const set of sets) {
    const valueId = worldValues[set.id];
    if (!valueId) throw new Error(`variable “${set.name}” has no selected value`);
    const row = rowFor(set, valueId);
    values[set.id] = valueId;
    companions[set.id] = {
      identifier: companion(row.identifier),
      label: companion(row.label),
      text: companion(row.text),
    };
  }
  return { values, companions };
}

/** Recipe timestamps are not identity. A wall clock here would change the
 * outer intent digest on every prepare and block campaign resume. */
export function composeAppMapCombineCellWrapper(input: {
  cellId: string;
  childRootId: string;
  childGraph: Record<string, Recipe>;
  sets: OptionRunSet[];
  map?: AppMap;
  at?: number;
}): {
  root: Recipe;
  graph: Record<string, Recipe>;
  prefixes: Record<string, string>;
  wrapperInputs: CombineCellWrapperInputs;
} {
  const at = input.at ?? 0;
  const prefixes: Record<string, string> = {};
  const used = new Set<string>();
  for (const [index, set] of input.sets.entries()) {
    const prefix = appMapCombineCellVariablePrefix(set.id, index);
    if (used.has(prefix)) {
      throw new Error(`Combine cell wrapper prefix collided for variable ${set.id}`);
    }
    used.add(prefix);
    prefixes[set.id] = prefix;
  }

  const graph: Record<string, Recipe> = {};
  for (const [id, recipe] of Object.entries(input.childGraph)) {
    graph[id] = structuredClone(recipe);
  }
  if (!graph[input.childRootId]) {
    throw new Error("Combine cell wrapper is missing its child Test root");
  }

  const steps: RecipeStep[] = [];
  const wrapperInputs: CombineCellWrapperInputs = {};
  let appLaunched = false;
  const appLocale = input.sets.find((set) => set.apply.kind === "appLocale");
  const app = appLocale?.apply.kind === "appLocale" ? appLocale.apply.app : undefined;

  for (const set of input.sets) {
    const prefix = prefixes[set.id]!;
    const helpers = tapHelpers(prefix, at);
    for (const helperId of Object.keys(helpers)) {
      if (graph[helperId]) {
        throw new Error(
          `Combine cell wrapper helper ${helperId} collides with a frozen Test recipe`,
        );
      }
    }
    Object.assign(graph, helpers);
    if (set.apply.kind === "appLocale") {
      const relaunch = appLocaleShouldRelaunch(set.apply, graph, input.childRootId);
      steps.push(
        ...appLocaleRecipeSteps({
          app: set.apply.app,
          locale: `{{${prefix}}}`,
          relaunch: relaunch && !appLaunched,
          expectedLabels: appLocaleExpectedLabels(graph, input.childRootId),
        }),
      );
      if (relaunch && !appLaunched) appLaunched = true;
      steps.push({ kind: "device", action: "keyboard-dismiss" });
      steps.push({ kind: "sleep", ms: 250 });
      if (!relaunch) {
        const stayCheck = stayAppLocaleDestinationCheck(graph, input.childRootId);
        if (stayCheck) steps.push(stayCheck);
      }
      continue;
    }
    if (set.apply.kind === "toggle") {
      throw new Error("toggles are not runnable yet");
    }
    const resolved = assertOptionSandwichReady(set, input.map);
    steps.push(...navStepsToRecipe(resolved.entry, app));
    steps.push(...selectSteps(prefix));
    steps.push(...navStepsToRecipe(resolved.exit, app));
  }

  steps.push({ kind: "module", recipeId: input.childRootId });

  for (const set of [...input.sets].reverse()) {
    if (!set.restoreId?.trim()) continue;
    if (set.apply.kind === "appLocale") {
      steps.push(
        ...appLocaleRecipeSteps({
          app: set.apply.app,
          locale: set.restoreId.trim(),
          relaunch: appLocaleShouldRelaunch(set.apply, graph, input.childRootId),
          expectedLabels: appLocaleExpectedLabels(graph, input.childRootId),
        }),
      );
      continue;
    }
    if (set.apply.kind === "list") {
      const resolved = assertOptionSandwichReady(set, input.map);
      steps.push(...navStepsToRecipe(resolved.entry, app));
      steps.push(...restoreListSteps(set));
      steps.push(...navStepsToRecipe(resolved.exit, app));
    }
  }

  const rootId = `cell-${input.cellId}`;
  if (graph[rootId]) {
    throw new Error(`Combine cell wrapper root ${rootId} collides with a frozen Test recipe`);
  }
  const root: Recipe = {
    id: rootId,
    title: `Combine cell ${input.cellId}`,
    description: `Scoped wrapper for ${input.childRootId}`,
    source: "custom",
    steps,
    createdAt: at,
    updatedAt: at,
  };
  graph[root.id] = root;
  return { root, graph, prefixes, wrapperInputs };
}

export function wrapperInputsForStatic(
  prefixes: Record<string, string>,
  staticInputs: CombineCellStaticInputs,
): CombineCellWrapperInputs {
  const inputs: CombineCellWrapperInputs = {};
  for (const [variableId, prefix] of Object.entries(prefixes)) {
    const valueId = staticInputs.values[variableId];
    const companions = staticInputs.companions[variableId];
    if (!valueId || !companions) continue;
    inputs[prefix] = valueId;
    inputs[`${prefix}_identifier`] = companions.identifier;
    inputs[`${prefix}_label`] = companions.label;
    inputs[`${prefix}_text`] = companions.text;
  }
  return inputs;
}
