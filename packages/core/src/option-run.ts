/**
 * Option sets × map paths.
 *
 * A set is any list that changes app state (language, location, theme, …).
 * Worlds are zip/cartesian/pairwise combinations; each world applies every
 * selected value then runs the compiled path.
 */
import { randomUUID } from "node:crypto";
import type {
  AppMap,
  VariableApply,
  VariableNavStep,
  VariableRow,
  AppMapVariableKind,
  RecipeStep,
  TargetProfile,
  TestData,
} from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import { freezeRecipeGraph, readRecipe } from "./recipes.js";
import { prepareRunMatrix, redactRunMatrix, type PreparedRunMatrix } from "./run-matrix.js";
import { enqueueJob, type EnqueueJobInput, type TestJob } from "./session.js";
import { currentOperationContext } from "./operation-context.js";
import {
  defaultGrokLocaleScope,
  localeNavFromConnectionActions,
  localeNavFromRecipeSteps,
} from "./locale-run.js";

const NONE = "-";
const MAX_WORLDS = 32;

export type OptionRunSet = {
  id: string;
  name: string;
  kind: AppMapVariableKind;
  apply: VariableApply;
  options: VariableRow[];
  restoreId?: string;
  screenshotEach?: boolean;
};

export type OptionRunRequest = {
  sets: OptionRunSet[];
  /** Present when In/Out are map connection ids. */
  map?: AppMap;
  selected?: Record<string, string[]>;
  strategy?: "zip" | "cartesian" | "pairwise";
  app?: string;
  relaunch?: boolean;
  screenshotEach?: boolean;
  restoreAtEnd?: boolean;
  profileId?: string;
  preset?: "grok";
};

export type ResolvedVariableApply = {
  entry: VariableNavStep[];
  exit: VariableNavStep[];
};

function recipeStepsFromConnectionActions(
  actions: AppMap["connections"][string]["actions"],
): import("@relay/protocol").RecipeStep[] {
  const steps: import("@relay/protocol").RecipeStep[] = [];
  for (const action of actions) {
    if (action.kind === "recorded" || action.kind === "steps") steps.push(...action.steps);
    else if (action.kind === "tap")
      steps.push({ kind: "tap", target: action.target, id: action.id });
    else if (action.kind === "wait") steps.push({ kind: "sleep", ms: action.ms, id: action.id });
    else if (action.kind === "back") steps.push({ kind: "key", key: "back", id: action.id });
  }
  return steps;
}

/** Compile In/Out from recorded connections (actions only) or flattened nav. Never invents Grok nav. */
export function resolveVariableApply(
  set: OptionRunSet,
  map?: AppMap,
  opts?: { profileId?: string; preset?: "grok" },
): ResolvedVariableApply {
  if (set.apply.kind === "toggle") throw new Error("toggles are not runnable yet");
  const apply = set.apply;
  let entry: VariableNavStep[] = [];
  let exit: VariableNavStep[] = [];
  const pickId = apply.pickStepId?.trim();
  if (apply.inConnectionId?.trim() && map) {
    const connection = map.connections[apply.inConnectionId.trim()];
    if (!connection) throw new Error(`In path “${apply.inConnectionId}” is missing from the map`);
    const recipeSteps = recipeStepsFromConnectionActions(connection.actions);
    const pickIndex = pickId
      ? recipeSteps.findIndex((step) => step.id === pickId || step.id?.endsWith(pickId))
      : -1;
    if (pickIndex >= 0) {
      entry = localeNavFromRecipeSteps(recipeSteps.slice(0, pickIndex)) as VariableNavStep[];
      if (!apply.outConnectionId?.trim() && !apply.exitPath?.length) {
        exit = localeNavFromRecipeSteps(recipeSteps.slice(pickIndex + 1)) as VariableNavStep[];
      }
    } else {
      entry = localeNavFromConnectionActions(connection.actions) as VariableNavStep[];
    }
  } else {
    entry = [...(apply.entryPath ?? []), ...(apply.pickerPath ?? [])];
  }
  if (apply.outConnectionId?.trim() && map) {
    const connection = map.connections[apply.outConnectionId.trim()];
    if (!connection) throw new Error(`Out path “${apply.outConnectionId}” is missing from the map`);
    exit = localeNavFromConnectionActions(connection.actions) as VariableNavStep[];
  } else if (!exit.length) {
    exit = [...(apply.exitPath ?? [])];
  }
  const wantGrok = opts?.preset === "grok" || opts?.profileId === "grok-ios";
  if (!entry.length && set.kind === "language" && wantGrok) {
    const grok = defaultGrokLocaleScope(["en"]);
    entry = [...(grok.entryPath ?? []), ...(grok.languagePath ?? [])] as VariableNavStep[];
  }
  return { entry, exit };
}

export function assertOptionSandwichReady(
  set: OptionRunSet,
  map?: AppMap,
  work?: { startScreenId?: string },
  opts?: { profileId?: string; preset?: "grok" },
): ResolvedVariableApply {
  const resolved = resolveVariableApply(set, map, opts);
  if (!resolved.entry.length && !(set.apply.kind === "list" && set.apply.inConnectionId && !map)) {
    if (!resolved.entry.length) {
      throw new Error("Record how you open this list");
    }
  }
  if (!resolved.entry.length) throw new Error("Record how you open this list");
  const listScreenId = set.apply.kind === "list" ? set.apply.listScreenId : undefined;
  const workStart = work?.startScreenId?.trim();
  if (listScreenId && workStart && listScreenId !== workStart && !resolved.exit.length) {
    throw new Error("Record how you get back — you’ll still be on this list");
  }
  return resolved;
}

/** Derive stable option ids from a11y only — never invents In/Out nav. */
export function stabilizeOptionIds(rows: VariableRow[]): VariableRow[] {
  return rows.map((row) => {
    const current = row.id.trim();
    if (current && current !== "und") return { ...row, id: current };
    const identifier = row.identifier?.trim();
    const fromId = identifier?.match(
      /(?:^|[.:/_-])([a-z]{2}(?:-[A-Za-z]{2})?|[a-z0-9]{2,})$/i,
    )?.[1];
    const slug = (row.label ?? row.text ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return { ...row, id: (fromId || slug || current || "option").slice(0, 48) };
  });
}

function sanitizeId(value: string): string {
  const id = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^(\d)/, "_$1");
  return id || "option";
}

function selectedIds(set: OptionRunSet, selected?: Record<string, string[]>): string[] {
  const override = selected?.[set.id]?.map((id) => id.trim()).filter(Boolean);
  const ids = override?.length ? override : set.options.map((row) => row.id.trim()).filter(Boolean);
  const known = new Set(set.options.map((row) => row.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`variable “${set.name}” has no option ${id}`);
  }
  if (!ids.length) throw new Error(`variable “${set.name}” needs at least one option`);
  return [...new Set(ids)];
}

function rowFor(set: OptionRunSet, id: string): VariableRow {
  return set.options.find((row) => row.id === id) ?? { id };
}

export function defaultOptionMatrixStrategy(setCount: number): "zip" | "cartesian" {
  return setCount > 1 ? "cartesian" : "zip";
}

export async function prepareOptionRunMatrix(
  request: OptionRunRequest,
  seed?: number,
): Promise<PreparedRunMatrix> {
  if (!request.sets.length) throw new Error("at least one variable is required");
  for (const set of request.sets) {
    if (set.apply.kind === "toggle") {
      throw new Error("toggles are not runnable yet");
    }
  }
  const strategy = request.strategy ?? defaultOptionMatrixStrategy(request.sets.length);
  if (strategy === "pairwise") {
    throw new Error("pairwise option matrices are not runnable yet");
  }
  const matrices: PreparedRunMatrix[] = [];
  for (const set of request.sets) {
    const ids = selectedIds(set, request.selected);
    const variables: TestData[] = [
      { id: `${set.id}`, name: set.id, scope: "shared", source: "list", values: ids },
      {
        id: `${set.id}_identifier`,
        name: `${set.id}_identifier`,
        scope: "shared",
        source: "list",
        values: ids.map((id) => rowFor(set, id).identifier?.trim() || NONE),
      },
      {
        id: `${set.id}_label`,
        name: `${set.id}_label`,
        scope: "shared",
        source: "list",
        values: ids.map((id) => rowFor(set, id).label?.trim() || NONE),
      },
      {
        id: `${set.id}_text`,
        name: `${set.id}_text`,
        scope: "shared",
        source: "list",
        values: ids.map((id) => rowFor(set, id).text?.trim() || NONE),
      },
    ];
    matrices.push(
      await prepareRunMatrix({
        strategy: "zip",
        seed,
        maxCases: MAX_WORLDS,
        variables,
      }),
    );
  }

  if (matrices.length === 1) return matrices[0]!;

  const maxCases = MAX_WORLDS;
  let combined: Array<{ name: string; values: Record<string, string> }> = [
    { name: "", values: {} },
  ];
  for (let index = 0; index < matrices.length; index += 1) {
    const set = request.sets[index]!;
    const next: typeof combined = [];
    for (const left of combined) {
      for (const right of matrices[index]!.cases) {
        const optionId = right.values[set.id] ?? "";
        next.push({
          name: [left.name, `${set.name}: ${optionId}`].filter(Boolean).join(" · "),
          values: { ...left.values, ...right.values },
        });
        if (next.length > maxCases) {
          throw new Error(`option matrix exceeds ${maxCases} worlds`);
        }
      }
    }
    combined = next;
  }

  if (strategy === "zip") {
    const length = Math.min(...matrices.map((matrix) => matrix.cases.length));
    combined = [];
    for (let index = 0; index < length; index += 1) {
      let values: Record<string, string> = {};
      const parts: string[] = [];
      for (let setIndex = 0; setIndex < request.sets.length; setIndex += 1) {
        const set = request.sets[setIndex]!;
        const row = matrices[setIndex]!.cases[index]!;
        values = { ...values, ...row.values };
        parts.push(`${set.name}: ${row.values[set.id] ?? ""}`);
      }
      combined.push({ name: parts.join(" · "), values });
    }
  }

  const matrixId = randomUUID();
  return {
    id: matrixId,
    createdAt: Date.now(),
    seed: seed ?? Date.now(),
    strategy,
    cases: combined.map((row, index) => ({
      id: `${matrixId}:${index + 1}`,
      name: row.name || `World ${index + 1}`,
      index,
      values: row.values,
      provenance: [],
    })),
  };
}

export function navStepsToRecipe(steps: VariableNavStep[] | undefined, app?: string): RecipeStep[] {
  if (!steps?.length) return [];
  const out: RecipeStep[] = [];
  for (const step of steps) {
    if (step.kind === "wait") {
      out.push({ kind: "sleep", ms: Math.max(0, Math.min(120_000, Math.round(step.ms))) });
      continue;
    }
    if (step.kind === "back") {
      out.push({ kind: "key", key: "back" });
      continue;
    }
    if (step.kind === "relaunch") {
      if (!app) throw new Error("relaunch requires app");
      out.push({ kind: "app", action: "open", app, relaunch: true });
      continue;
    }
    if (step.kind === "openApp") {
      const target = step.app?.trim() || app;
      if (!target) throw new Error("openApp requires step.app or app");
      out.push({ kind: "app", action: "open", app: target, relaunch: step.relaunch === true });
      out.push({ kind: "sleep", ms: 900 });
      continue;
    }
    if (step.kind === "scroll") {
      const count = Math.max(1, Math.min(8, step.amount ?? 1));
      for (let i = 0; i < count; i += 1) {
        out.push({
          kind: "swipe",
          from: { x: 0.5, y: step.direction === "down" ? 0.72 : 0.32 },
          to: { x: 0.5, y: step.direction === "down" ? 0.32 : 0.72 },
          durationMs: 280,
        });
      }
      continue;
    }
    const target = step.target;
    if (target.identifier) out.push({ kind: "tap", target: { identifier: target.identifier } });
    else if (target.label) out.push({ kind: "tap", target: { label: target.label } });
    else if (target.text) out.push({ kind: "tap", target: { text: target.text } });
    else throw new Error("option nav tap requires identifier, label, or text");
  }
  return out;
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

export function composeOptionRunRecipes(input: {
  body: Recipe;
  request: OptionRunRequest;
  batchId: string;
}): { root: Recipe; graph: Record<string, Recipe> } {
  const app = input.request.app?.trim();
  const at = Date.now();
  const screenshot = input.request.screenshotEach !== false;
  const steps: RecipeStep[] = [];
  const graph: Record<string, Recipe> = {
    [input.body.id]: structuredClone(input.body),
  };

  if (app) {
    steps.push({
      kind: "app",
      action: "open",
      app,
      relaunch: input.request.relaunch !== false,
    });
    steps.push({ kind: "sleep", ms: 1200 });
  }

  for (const set of input.request.sets) {
    if (set.apply.kind === "toggle") {
      throw new Error("toggles are not runnable yet");
    }
    const prefix = sanitizeId(set.id);
    Object.assign(graph, tapHelpers(prefix, at));
    const resolved = assertOptionSandwichReady(set, input.request.map, undefined, {
      profileId: input.request.profileId,
      preset: input.request.preset,
    });
    steps.push(...navStepsToRecipe(resolved.entry, app));
    steps.push(...selectSteps(prefix));
    steps.push(...navStepsToRecipe(resolved.exit, app));
  }

  const singleLocale = input.request.sets.length === 1 && input.request.sets[0]?.id === "locale";
  if (screenshot) {
    steps.push({
      kind: "screenshot",
      caption: singleLocale ? "locale:{{locale}} before body" : "world before body",
    });
  }
  steps.push({ kind: "module", recipeId: input.body.id });
  if (screenshot) {
    steps.push({
      kind: "screenshot",
      caption: singleLocale ? "locale:{{locale}} after body" : "world after body",
    });
  }

  const root: Recipe = {
    id: `option-run-${input.batchId}`,
    title: `${input.body.title} · across`,
    description: `Option matrix over ${input.body.id}`,
    source: "custom",
    steps,
    createdAt: at,
    updatedAt: at,
  };
  graph[root.id] = root;
  return { root, graph };
}

export async function startOptionRecipeRun(input: {
  recipeId: string;
  compiledBody?: Recipe;
  compiledGraph?: Record<string, Recipe>;
  map?: AppMap;
  targetId: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  targetProfile?: TargetProfile;
  request: OptionRunRequest;
  title?: string;
  projectId?: string;
  ownerId?: string;
  seed?: number;
}): Promise<{
  id: string;
  recipeId: string;
  bodyRecipeId: string;
  title: string;
  createdAt: number;
  worlds: string[];
  matrix: PreparedRunMatrix;
  jobs: TestJob[];
  composedRecipeId: string;
}> {
  const targetId = input.targetId.trim();
  if (!targetId) throw new Error("target is required");
  const recipeId = input.recipeId.trim();
  const body = input.compiledBody ?? (recipeId ? await readRecipe(recipeId) : undefined);
  if (!body) throw new Error("compiled path or recipe is required");

  const batchId = randomUUID();
  const request = { ...input.request, ...(input.map ? { map: input.map } : {}) };
  for (const set of request.sets) {
    assertOptionSandwichReady(set, request.map, undefined, {
      profileId: request.profileId,
      preset: request.preset,
    });
  }
  const matrix = await prepareOptionRunMatrix(request, input.seed);
  const { root, graph: seedGraph } = composeOptionRunRecipes({
    body,
    request,
    batchId,
  });
  const bodyGraph = await freezeRecipeGraph(body, input.compiledGraph ?? {});
  const recipeGraph: Record<string, Recipe> = {
    ...bodyGraph,
    ...seedGraph,
    [root.id]: root,
  };
  const operation = currentOperationContext();
  const projectId = input.projectId?.trim() || operation?.projectId || "default";
  const ownerId = input.ownerId?.trim() || operation?.actorId;
  const title = input.title?.trim() || `${body.title} · across`;
  const safeMatrix = redactRunMatrix(matrix, []);

  const jobs = matrix.cases.map((item) => {
    const world = item.name || `world-${item.index + 1}`;
    const enqueue: EnqueueJobInput = {
      recipe: root.id,
      title: `${title} · ${world}`,
      serial: input.targetKind === "browser" ? undefined : targetId,
      platform: input.platform,
      targetKind: input.targetKind ?? "device",
      browserTargetId: input.browserTargetId,
      targetProfile: input.targetProfile,
      variables: item.values,
      recipeSnapshot: root,
      recipeGraph,
      batchId,
      caseIndex: item.index,
      caseCount: matrix.cases.length,
      projectId,
      ownerId,
      artifacts: [
        {
          kind: "frozen-inputs",
          capturedAt: matrix.createdAt,
          data: {
            matrixId: matrix.id,
            optionRunBatchId: batchId,
            seed: matrix.seed,
            caseIndex: item.index,
            caseCount: matrix.cases.length,
            world,
            values: safeMatrix.cases[item.index]?.values ?? item.values,
            kind: "combine",
          },
        },
      ],
    };
    return enqueueJob(enqueue);
  });

  return {
    id: batchId,
    recipeId: root.id,
    bodyRecipeId: body.id,
    title,
    createdAt: Date.now(),
    worlds: matrix.cases.map((item) => item.name),
    matrix: safeMatrix,
    jobs,
    composedRecipeId: root.id,
  };
}

export function variableFromLocaleScope(input: {
  locales: string[];
  languageOptions?: Record<string, string | { identifier?: string; label?: string; text?: string }>;
  entryPath?: VariableNavStep[];
  languagePath?: VariableNavStep[];
  restoreLocale?: string;
  screenshotEachLocale?: boolean;
}): OptionRunSet {
  const options: VariableRow[] = input.locales.map((locale) => {
    const raw = input.languageOptions?.[locale];
    if (typeof raw === "string") return { id: locale, label: raw };
    if (raw && typeof raw === "object") {
      return {
        id: locale,
        ...(raw.identifier?.trim() ? { identifier: raw.identifier.trim() } : {}),
        ...(raw.label?.trim() ? { label: raw.label.trim() } : {}),
        ...(raw.text?.trim() ? { text: raw.text.trim() } : {}),
      };
    }
    return { id: locale, label: locale };
  });
  return {
    id: "locale",
    name: "Language",
    kind: "language",
    apply: {
      kind: "list",
      ...(input.entryPath?.length ? { entryPath: input.entryPath } : {}),
      ...(input.languagePath?.length ? { pickerPath: input.languagePath } : {}),
    },
    options,
    ...(input.restoreLocale?.trim() ? { restoreId: input.restoreLocale.trim() } : {}),
    screenshotEach: input.screenshotEachLocale !== false,
  };
}
