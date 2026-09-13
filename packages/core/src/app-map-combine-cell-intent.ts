import type { AppMapCompiledRuntimeTargetProfile, RecipeStep } from "@relay/protocol";
import { createHash } from "node:crypto";
import {
  appMapCombineCellId,
  canonicalAppMapCombineCellValues,
  isAppMapCombineCellId,
  sameAppMapCombineCellValues,
} from "./app-map-combine-cell.js";
import type { CombineCellStaticInputs } from "./app-map-combine-cell-wrapper.js";
import {
  digestAppMapTestExecutionValue,
  parseAppMapTestExecutionIntent,
  parseCanonicalAppMapTestRecipe,
  parseCanonicalAppMapTestRecipeGraph,
  type AppMapTestExecutionIntent,
} from "./app-map-test-execution-intent.js";
import type { Recipe } from "./recipes.js";
import {
  parseAppMapRuntimeTargetProfile,
  sameAppMapRuntimeTargetProfile,
} from "./app-map-runtime-target-profile.js";

export const appMapCombineCellExecutionIntentArtifactKind =
  "app-map-combine-cell-execution-intent" as const;

export type AppMapCombineCellExecutionIntent = {
  schemaVersion: 1;
  kind: typeof appMapCombineCellExecutionIntentArtifactKind;
  cell: {
    cellId: string;
    testId: string;
    values: Record<string, string>;
  };
  selectedRuntimeTargetProfile: AppMapCompiledRuntimeTargetProfile;
  child: AppMapTestExecutionIntent;
  wrapper: {
    rootRecipeId: string;
    recipeGraphDigest: string;
    rootRecipeDigest: string;
    childRootRecipeId: string;
    childRecipeGraphDigest: string;
  };
  staticInputs: CombineCellStaticInputs;
  digest: string;
  recipeGraph: Record<string, Recipe>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function referencedRecipeIds(step: RecipeStep): string[] {
  const nested =
    step.kind === "module" || step.kind === "repeat"
      ? [step.recipeId]
      : step.kind === "branch"
        ? [step.thenRecipeId, ...(step.elseRecipeId ? [step.elseRecipeId] : [])]
        : [];
  return [
    ...nested,
    ...(step.check?.cleanup ? [step.check.cleanup.recipeId] : []),
    ...(step.check?.recovery ? [step.check.recovery.recipeId] : []),
    ...(step.check?.recovery?.coldRecipeId ? [step.check.recovery.coldRecipeId] : []),
  ];
}

export function reachableRecipeGraph(
  graph: Readonly<Record<string, Recipe>>,
  rootId: string,
): Record<string, Recipe> | undefined {
  const out: Record<string, Recipe> = {};
  const visit = (id: string): boolean => {
    if (out[id]) return true;
    const recipe = graph[id];
    if (!recipe) return false;
    out[id] = recipe;
    return recipe.steps.every((step) => referencedRecipeIds(step).every(visit));
  };
  return visit(rootId) ? out : undefined;
}

function sameRecipeGraph(left: Record<string, Recipe>, right: Record<string, Recipe>): boolean {
  const leftIds = Object.keys(left).sort();
  const rightIds = Object.keys(right).sort();
  if (leftIds.length !== rightIds.length || leftIds.some((id, index) => id !== rightIds[index])) {
    return false;
  }
  return leftIds.every(
    (id) => digestAppMapTestExecutionValue(left[id]) === digestAppMapTestExecutionValue(right[id]),
  );
}

function profile(value: unknown): AppMapCompiledRuntimeTargetProfile | undefined {
  return parseAppMapRuntimeTargetProfile(value);
}

function parseStaticInputs(value: unknown): CombineCellStaticInputs | undefined {
  if (!isRecord(value) || !ownKeys(value, ["values", "companions"])) return undefined;
  if (!isRecord(value.values) || !isRecord(value.companions)) return undefined;
  const values: Record<string, string> = {};
  for (const [variableId, valueId] of Object.entries(value.values)) {
    if (!string(variableId) || !string(valueId)) return undefined;
    values[variableId] = valueId;
  }
  const companions: CombineCellStaticInputs["companions"] = {};
  for (const [variableId, entry] of Object.entries(value.companions)) {
    if (!string(variableId) || !isRecord(entry)) return undefined;
    if (
      !ownKeys(entry, ["identifier", "label", "text"]) ||
      typeof entry.identifier !== "string" ||
      typeof entry.label !== "string" ||
      typeof entry.text !== "string"
    ) {
      return undefined;
    }
    companions[variableId] = {
      identifier: entry.identifier,
      label: entry.label,
      text: entry.text,
    };
  }
  const valueIds = Object.keys(values).sort();
  const companionIds = Object.keys(companions).sort();
  if (
    valueIds.length !== companionIds.length ||
    valueIds.some((id, index) => id !== companionIds[index])
  ) {
    return undefined;
  }
  return { values: canonicalAppMapCombineCellValues(values), companions };
}

function wrapperChildModuleRoot(root: Recipe): string | undefined {
  const modules = root.steps.filter((step) => step.kind === "module");
  const child = modules.find((step) => step.kind === "module");
  return child && child.kind === "module" ? child.recipeId : undefined;
}

export function digestAppMapCombineCellExecutionIntent(input: {
  cell: AppMapCombineCellExecutionIntent["cell"];
  selectedRuntimeTargetProfile: AppMapCompiledRuntimeTargetProfile;
  childDigest: string;
  wrapper: AppMapCombineCellExecutionIntent["wrapper"];
  staticInputs: CombineCellStaticInputs;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        cell: {
          cellId: input.cell.cellId,
          testId: input.cell.testId,
          values: appMapCombineCellValueEntriesForDigest(input.cell.values),
        },
        selectedRuntimeTargetProfile: input.selectedRuntimeTargetProfile,
        childDigest: input.childDigest,
        wrapper: input.wrapper,
        staticInputs: {
          values: appMapCombineCellValueEntriesForDigest(input.staticInputs.values),
          companions: Object.fromEntries(
            Object.entries(input.staticInputs.companions).sort(([left], [right]) =>
              left < right ? -1 : left > right ? 1 : 0,
            ),
          ),
        },
      }),
    )
    .digest("hex");
}

function appMapCombineCellValueEntriesForDigest(values: Record<string, string>) {
  return Object.entries(canonicalAppMapCombineCellValues(values)).map(([variableId, valueId]) => ({
    variableId,
    valueId,
  }));
}

export function createAppMapCombineCellExecutionIntent(input: {
  cellId: string;
  testId: string;
  values: Record<string, string>;
  selectedRuntimeTargetProfile: AppMapCompiledRuntimeTargetProfile;
  child: AppMapTestExecutionIntent;
  wrapperRoot: Recipe;
  recipeGraph: Record<string, Recipe>;
  staticInputs: CombineCellStaticInputs;
}): AppMapCombineCellExecutionIntent {
  const values = canonicalAppMapCombineCellValues(input.values);
  const recomputed = appMapCombineCellId(input.testId, values);
  if (recomputed !== input.cellId || !isAppMapCombineCellId(input.cellId)) {
    throw new Error("Combine cell identity does not match its canonical digest");
  }
  const recipeGraph = parseCanonicalAppMapTestRecipeGraph(input.recipeGraph);
  const wrapperRoot = parseCanonicalAppMapTestRecipe(input.wrapperRoot, input.wrapperRoot.id);
  if (!recipeGraph || !wrapperRoot) {
    throw new Error("Combine cell wrapper graph is not a parser-validated recipe graph");
  }
  const childRootId = input.child.sourcePlan.rootRecipeId;
  const frozenChild = reachableRecipeGraph(input.child.recipeGraph, childRootId);
  const reachableChild = reachableRecipeGraph(recipeGraph, childRootId);
  if (!reachableChild || !frozenChild || !sameRecipeGraph(reachableChild, frozenChild)) {
    throw new Error("Combine cell wrapper does not preserve the frozen child Test graph");
  }
  const moduleRoot = wrapperChildModuleRoot(wrapperRoot);
  if (moduleRoot !== childRootId) {
    throw new Error("Combine cell wrapper does not module the frozen child Test root");
  }
  const wrapper = {
    rootRecipeId: wrapperRoot.id,
    recipeGraphDigest: digestAppMapTestExecutionValue(recipeGraph),
    rootRecipeDigest: digestAppMapTestExecutionValue(wrapperRoot),
    childRootRecipeId: childRootId,
    childRecipeGraphDigest: input.child.sourcePlan.recipeGraphDigest,
  };
  const cell = { cellId: input.cellId, testId: input.testId, values };
  const intent: AppMapCombineCellExecutionIntent = {
    schemaVersion: 1,
    kind: appMapCombineCellExecutionIntentArtifactKind,
    cell,
    selectedRuntimeTargetProfile: structuredClone(input.selectedRuntimeTargetProfile),
    child: structuredClone(input.child),
    wrapper,
    staticInputs: structuredClone(input.staticInputs),
    digest: digestAppMapCombineCellExecutionIntent({
      cell,
      selectedRuntimeTargetProfile: input.selectedRuntimeTargetProfile,
      childDigest: digestAppMapTestExecutionValue(input.child),
      wrapper,
      staticInputs: input.staticInputs,
    }),
    recipeGraph: structuredClone(recipeGraph),
  };
  if (!parseAppMapCombineCellExecutionIntent(intent)) {
    throw new Error("Cannot persist an inconsistent Combine cell execution intent");
  }
  return intent;
}

export function parseAppMapCombineCellExecutionIntent(
  value: unknown,
): AppMapCombineCellExecutionIntent | undefined {
  try {
    return parseAppMapCombineCellExecutionIntentValue(value);
  } catch {
    return undefined;
  }
}

function parseAppMapCombineCellExecutionIntentValue(
  value: unknown,
): AppMapCombineCellExecutionIntent | undefined {
  if (
    !isRecord(value) ||
    !ownKeys(value, [
      "schemaVersion",
      "kind",
      "cell",
      "selectedRuntimeTargetProfile",
      "child",
      "wrapper",
      "staticInputs",
      "digest",
      "recipeGraph",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== appMapCombineCellExecutionIntentArtifactKind
  ) {
    return undefined;
  }
  const cell = isRecord(value.cell) ? value.cell : undefined;
  const wrapper = isRecord(value.wrapper) ? value.wrapper : undefined;
  const child = parseAppMapTestExecutionIntent(value.child);
  const recipeGraph = parseCanonicalAppMapTestRecipeGraph(value.recipeGraph);
  const selected = profile(value.selectedRuntimeTargetProfile);
  const staticInputs = parseStaticInputs(value.staticInputs);
  if (
    !cell ||
    !ownKeys(cell, ["cellId", "testId", "values"]) ||
    !string(cell.cellId) ||
    !string(cell.testId) ||
    !isRecord(cell.values) ||
    !wrapper ||
    !ownKeys(wrapper, [
      "rootRecipeId",
      "recipeGraphDigest",
      "rootRecipeDigest",
      "childRootRecipeId",
      "childRecipeGraphDigest",
    ]) ||
    !string(wrapper.rootRecipeId) ||
    !digest(wrapper.recipeGraphDigest) ||
    !digest(wrapper.rootRecipeDigest) ||
    !string(wrapper.childRootRecipeId) ||
    !digest(wrapper.childRecipeGraphDigest) ||
    !child ||
    !recipeGraph ||
    !selected ||
    !staticInputs ||
    !digest(value.digest)
  ) {
    return undefined;
  }
  const values: Record<string, string> = {};
  for (const [variableId, valueId] of Object.entries(cell.values)) {
    if (!string(variableId) || !string(valueId)) return undefined;
    values[variableId] = valueId;
  }
  const canonicalValues = canonicalAppMapCombineCellValues(values);
  if (appMapCombineCellId(cell.testId, canonicalValues) !== cell.cellId) return undefined;
  if (cell.testId !== child.sourcePlan.testId) return undefined;
  if (!sameAppMapCombineCellValues(staticInputs.values, canonicalValues)) return undefined;
  const root = recipeGraph[wrapper.rootRecipeId];
  if (!root || root.id !== wrapper.rootRecipeId) return undefined;
  if (digestAppMapTestExecutionValue(recipeGraph) !== wrapper.recipeGraphDigest) return undefined;
  if (digestAppMapTestExecutionValue(root) !== wrapper.rootRecipeDigest) return undefined;
  if (wrapper.childRootRecipeId !== child.sourcePlan.rootRecipeId) return undefined;
  if (wrapper.childRecipeGraphDigest !== child.sourcePlan.recipeGraphDigest) return undefined;
  const frozenChild = reachableRecipeGraph(child.recipeGraph, child.sourcePlan.rootRecipeId);
  const reachableChild = reachableRecipeGraph(recipeGraph, child.sourcePlan.rootRecipeId);
  if (!reachableChild || !frozenChild || !sameRecipeGraph(reachableChild, frozenChild)) {
    return undefined;
  }
  if (wrapperChildModuleRoot(root) !== child.sourcePlan.rootRecipeId) return undefined;
  if (
    !child.selectedRuntimeTargetProfile ||
    !sameAppMapRuntimeTargetProfile(selected, child.selectedRuntimeTargetProfile)
  ) {
    return undefined;
  }
  const expectedDigest = digestAppMapCombineCellExecutionIntent({
    cell: { cellId: cell.cellId, testId: cell.testId, values: canonicalValues },
    selectedRuntimeTargetProfile: selected,
    childDigest: digestAppMapTestExecutionValue(child),
    wrapper: {
      rootRecipeId: wrapper.rootRecipeId,
      recipeGraphDigest: wrapper.recipeGraphDigest,
      rootRecipeDigest: wrapper.rootRecipeDigest,
      childRootRecipeId: wrapper.childRootRecipeId,
      childRecipeGraphDigest: wrapper.childRecipeGraphDigest,
    },
    staticInputs,
  });
  if (expectedDigest !== value.digest) return undefined;
  return structuredClone(value) as AppMapCombineCellExecutionIntent;
}

export function parseAppMapCombineCellExecutionIntentArtifact(
  artifact: unknown,
): AppMapCombineCellExecutionIntent | undefined {
  if (!isRecord(artifact) || artifact.kind !== appMapCombineCellExecutionIntentArtifactKind) {
    return undefined;
  }
  return parseAppMapCombineCellExecutionIntent(artifact.data);
}
