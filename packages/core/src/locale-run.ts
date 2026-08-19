/**
 * First-class "recipe × locales" execution.
 *
 * One authored recipe is the loop body. Relay expands locales into frozen
 * matrix cases, prepends a language-switch prelude (entry → language picker →
 * select row), and runs each case as a normal job. Exporting those runs as a
 * pack lives in locale-run-pack.ts.
 */
import { createHash, randomUUID } from "node:crypto";
import type { ActionSpec, AppMap, RecipeStep, TargetProfile } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { resolveLanguageOptions, listLanguageProfilesSync } from "./language-profiles.js";
import { extractSwitcherOptionsFromNodes } from "./switcher-option-rows.js";
import { currentOperationContext } from "./operation-context.js";
import { freezeRecipeGraph, readRecipe, type Recipe } from "./recipes.js";
import { prepareRunMatrix, redactRunMatrix, type PreparedRunMatrix } from "./run-matrix.js";
import { enqueueJob, type EnqueueJobInput, type TestJob } from "./session.js";

/** Matrix list values cannot be blank (zip strips empties). */
const NONE = "-";

export type LocaleNavStep =
  | {
      kind: "tap";
      target: {
        identifier?: string;
        label?: string;
        text?: string;
      };
    }
  | { kind: "back" }
  | { kind: "wait"; ms: number }
  | { kind: "scroll"; direction: "up" | "down"; amount?: number }
  | { kind: "relaunch" }
  | { kind: "openApp"; app: string; relaunch?: boolean };

export type LocaleRunScope = {
  locales: string[];
  app?: string;
  relaunch?: boolean;
  entryPath?: LocaleNavStep[];
  languagePath?: LocaleNavStep[];
  languageOptions?: Record<
    string,
    | string
    | {
        label?: string;
        identifier?: string;
        text?: string;
      }
  >;
  restoreLocale?: string;
  restoreAfterEach?: boolean;
  restoreAtEnd?: boolean;
  screenshotEachLocale?: boolean;
};

export type LocaleRunRequest = {
  recipeId: string;
  /** In-memory compiled body (App Map flow). Skips the recipe store. */
  compiledBody?: Recipe;
  compiledGraph?: Record<string, Recipe>;
  targetId: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  targetProfile?: TargetProfile;
  scope: LocaleRunScope;
  title?: string;
  projectId?: string;
  ownerId?: string;
  seed?: number;
};

export type LocaleRunBatch = {
  id: string;
  recipeId: string;
  bodyRecipeId: string;
  title: string;
  createdAt: number;
  locales: string[];
  matrix: PreparedRunMatrix;
  jobs: TestJob[];
  composedRecipeId: string;
};

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function normalizeLocales(locales: string[]): string[] {
  const next = [...new Set(locales.map((locale) => locale.trim()).filter(Boolean))];
  if (!next.length) throw new Error("at least one locale is required");
  if (next.length > 250) throw new Error("at most 250 locales per run");
  return next;
}

function optionForLocale(
  scope: LocaleRunScope,
  locale: string,
): { label?: string; identifier?: string; text?: string } {
  const raw = scope.languageOptions?.[locale];
  if (typeof raw === "string") return { label: raw };
  if (raw && typeof raw === "object") {
    return {
      ...(raw.identifier?.trim() ? { identifier: raw.identifier.trim() } : {}),
      ...(raw.label?.trim() ? { label: raw.label.trim() } : {}),
      ...(raw.text?.trim() ? { text: raw.text.trim() } : {}),
    };
  }
  return { label: locale };
}

export type TaughtLocaleExample = {
  locale: string;
  identifier?: string;
  label?: string;
  text?: string;
};

export type InferredLocaleOption = {
  locale: string;
  identifier?: string;
  label?: string;
  text?: string;
};

function exampleMatchesOption(
  example: TaughtLocaleExample,
  option: { id: string; label: string; identifier?: string },
): boolean {
  const identifier = example.identifier?.trim();
  if (identifier && option.identifier?.trim() === identifier) return true;
  const label = example.label?.trim().toLocaleLowerCase();
  if (label && option.label.toLocaleLowerCase() === label) return true;
  const text = example.text?.trim().toLocaleLowerCase();
  if (text && option.label.toLocaleLowerCase().includes(text)) return true;
  const locale = example.locale.trim().toLocaleLowerCase();
  return option.id.toLocaleLowerCase() === locale;
}

function optionTarget(option: InferredLocaleOption): {
  identifier?: string;
  label?: string;
  text?: string;
} {
  if (option.identifier?.trim()) return { identifier: option.identifier.trim() };
  if (option.label?.trim()) return { label: option.label.trim() };
  if (option.text?.trim()) return { text: option.text.trim() };
  return { label: option.locale };
}

/**
 * Teach 1–2 locale rows from the picker a11y tree, then infer the rest.
 * Stable accessibility identifiers win over localized labels.
 */
export function inferLocaleOptionsFromTeach(input: {
  nodes: SnapshotNode[];
  examples: TaughtLocaleExample[];
}): {
  options: InferredLocaleOption[];
  languageOptions: NonNullable<LocaleRunScope["languageOptions"]>;
  locales: string[];
} {
  const extracted = extractSwitcherOptionsFromNodes(input.nodes);
  const examples = input.examples
    .map((example) => ({
      locale: example.locale.trim(),
      ...(example.identifier?.trim() ? { identifier: example.identifier.trim() } : {}),
      ...(example.label?.trim() ? { label: example.label.trim() } : {}),
      ...(example.text?.trim() ? { text: example.text.trim() } : {}),
    }))
    .filter((example) => example.locale);
  const taughtLocaleByExtractedId = new Map<string, string>();
  for (const example of examples) {
    const match = extracted.find((option) => exampleMatchesOption(example, option));
    if (match) taughtLocaleByExtractedId.set(match.id, example.locale);
  }

  const options: InferredLocaleOption[] = extracted.map((option) => {
    const locale = taughtLocaleByExtractedId.get(option.id) ?? option.id;
    return {
      locale,
      label: option.label,
      ...(option.identifier ? { identifier: option.identifier } : {}),
    };
  });
  for (const example of examples) {
    if (options.some((option) => option.locale === example.locale)) continue;
    options.unshift({
      locale: example.locale,
      ...(example.identifier ? { identifier: example.identifier } : {}),
      ...(example.label ? { label: example.label } : {}),
      ...(example.text ? { text: example.text } : {}),
    });
  }

  const languageOptions: NonNullable<LocaleRunScope["languageOptions"]> = {};
  for (const option of options) languageOptions[option.locale] = optionTarget(option);
  return {
    options,
    languageOptions,
    locales: options.map((option) => option.locale),
  };
}

export function localeRunScopeFromTeach(input: {
  nodes: SnapshotNode[];
  examples: TaughtLocaleExample[];
  locales?: string[];
  app?: string;
  entryPath?: LocaleNavStep[];
  languagePath?: LocaleNavStep[];
  screenshotEachLocale?: boolean;
  restoreLocale?: string;
  restoreAtEnd?: boolean;
}): LocaleRunScope {
  const inferred = inferLocaleOptionsFromTeach(input);
  const locales = input.locales?.length
    ? [...new Set(input.locales.map((locale) => locale.trim()).filter(Boolean))]
    : inferred.locales;
  if (!locales.length) throw new Error("at least one locale is required");
  const languageOptions: NonNullable<LocaleRunScope["languageOptions"]> = {};
  for (const locale of locales) {
    languageOptions[locale] = inferred.languageOptions[locale] ?? { label: locale };
  }
  return completeTaughtLocaleScope({
    locales,
    languageOptions,
    screenshotEachLocale: input.screenshotEachLocale !== false,
    restoreAtEnd: input.restoreAtEnd !== false,
    restoreLocale: input.restoreLocale?.trim() || locales[0],
    ...(input.app?.trim() ? { app: input.app.trim() } : {}),
    ...(input.entryPath ? { entryPath: input.entryPath } : {}),
    ...(input.languagePath ? { languagePath: input.languagePath } : {}),
  });
}

/** Taught a11y rows are not a nav prelude. Never invent Grok Settings unless asked. */
export function completeTaughtLocaleScope(
  scope: LocaleRunScope,
  opts?: { profileId?: string; preset?: "grok" },
): LocaleRunScope {
  const hasNav = Boolean(scope.entryPath?.length || scope.languagePath?.length);
  const wantGrok = opts?.preset === "grok" || opts?.profileId === "grok-ios";
  if (hasNav) {
    if (scope.app?.trim() || !wantGrok) return scope;
    const nav = defaultGrokLocaleScope(scope.locales);
    return { ...scope, ...(nav.app ? { app: nav.app } : {}) };
  }
  if (!wantGrok) return scope;
  const nav = defaultGrokLocaleScope(scope.locales);
  return {
    ...nav,
    locales: scope.locales,
    languageOptions: scope.languageOptions ?? nav.languageOptions,
    screenshotEachLocale: scope.screenshotEachLocale,
    restoreAtEnd: scope.restoreAtEnd,
    restoreLocale: scope.restoreLocale ?? nav.restoreLocale,
    ...(scope.app?.trim() ? { app: scope.app.trim() } : {}),
  };
}

const PICKER_SCREEN_RE = /language|locale|idioma|sprache|langue|言語|语言|語言/i;

export function isLocalePickerScreenTitle(title: string | undefined | null): boolean {
  return Boolean(title?.trim() && PICKER_SCREEN_RE.test(title));
}

/** Recorded / authored recipe steps → picker nav. Screenshots and asserts drop out. */
export function localeNavFromRecipeSteps(steps: readonly RecipeStep[]): LocaleNavStep[] {
  const out: LocaleNavStep[] = [];
  for (const step of steps) {
    if (step.kind === "tap") {
      const identifier = step.target.identifier?.trim();
      const label = step.target.label?.trim();
      const text = step.target.text?.trim();
      if (!identifier && !label && !text) continue;
      out.push({
        kind: "tap",
        target: {
          ...(identifier ? { identifier } : {}),
          ...(label ? { label } : {}),
          ...(text ? { text } : {}),
        },
      });
      continue;
    }
    if (step.kind === "sleep") {
      out.push({ kind: "wait", ms: Math.max(0, Math.min(120_000, Math.round(step.ms))) });
      continue;
    }
    if (step.kind === "key" && step.key === "back") {
      out.push({ kind: "back" });
      continue;
    }
    if (step.kind === "scroll") {
      out.push({
        kind: "scroll",
        direction: step.direction,
        ...(step.amount != null ? { amount: step.amount } : {}),
      });
      continue;
    }
    if (step.kind === "swipe") {
      out.push({ kind: "scroll", direction: step.from.y > step.to.y ? "down" : "up" });
      continue;
    }
    if (step.kind === "app" && step.action === "open" && step.app?.trim()) {
      out.push({
        kind: "openApp",
        app: step.app.trim(),
        ...(step.relaunch === true ? { relaunch: true } : {}),
      });
    }
  }
  return out;
}

function recipeStepsFromAction(action: ActionSpec): RecipeStep[] {
  if (action.kind === "recorded" || action.kind === "steps") return [...action.steps];
  if (action.kind === "tap") return [{ kind: "tap", target: action.target }];
  if (action.kind === "wait") return [{ kind: "sleep", ms: action.ms }];
  if (action.kind === "back") return [{ kind: "key", key: "back" }];
  if (action.kind === "home") return [{ kind: "key", key: "home" }];
  if (action.kind === "app" && action.action === "open" && action.app?.trim()) {
    return [
      {
        kind: "app",
        action: "open",
        app: action.app.trim(),
        ...(action.relaunch === true ? { relaunch: true } : {}),
      },
    ];
  }
  if (action.kind === "gesture" && action.gesture.kind === "scroll") {
    return [
      {
        kind: "scroll",
        direction: action.gesture.direction,
        ...(action.gesture.amount != null ? { amount: action.gesture.amount } : {}),
      },
    ];
  }
  if (action.kind === "gesture" && action.gesture.kind === "swipe") {
    return [
      {
        kind: "swipe",
        from: action.gesture.from,
        to: action.gesture.to,
        ...(action.gesture.durationMs != null ? { durationMs: action.gesture.durationMs } : {}),
      },
    ];
  }
  return [];
}

export function localeNavFromConnectionActions(actions: readonly ActionSpec[]): LocaleNavStep[] {
  return localeNavFromRecipeSteps(actions.flatMap((action) => recipeStepsFromAction(action)));
}

export type RecordedLocalePrelude = {
  entryPath: LocaleNavStep[];
  languagePath?: LocaleNavStep[];
  sourceConnectionId: string;
  sourceLabel: string;
};

function connectionDestinationTitle(map: AppMap, connectionId: string): string {
  const connection = map.connections[connectionId];
  if (!connection) return "";
  if (connection.destination.kind === "screen") {
    return (
      map.screens[connection.destination.screenId]?.title?.trim() || connection.label?.trim() || ""
    );
  }
  return connection.label?.trim() || "";
}

/**
 * Use a recorded map path to open the language list. Grok/profile nav is only
 * the fallback when this returns undefined.
 */
export function recordedLocalePreludeFromMap(
  map: AppMap,
  input?: {
    bodyFlowId?: string;
    selectedConnectionId?: string;
    liveScreenId?: string;
    kind?: string;
  },
): RecordedLocalePrelude | undefined {
  const bodyIds = new Set(
    (input?.bodyFlowId?.trim() ? map.flows[input.bodyFlowId.trim()]?.connectionIds : undefined) ??
      [],
  );
  let best:
    | {
        connectionId: string;
        score: number;
        nav: LocaleNavStep[];
        label: string;
      }
    | undefined;

  for (const connection of Object.values(map.connections)) {
    const nav = localeNavFromConnectionActions(connection.actions);
    if (!nav.length) continue;
    const destTitle = connectionDestinationTitle(map, connection.id);
    const destScreenId =
      connection.destination.kind === "screen" ? connection.destination.screenId : "";
    const picker =
      (input?.kind === undefined || input.kind === "language") &&
      (isLocalePickerScreenTitle(destTitle) || isLocalePickerScreenTitle(connection.label));
    const live = Boolean(input?.liveScreenId?.trim() && destScreenId === input.liveScreenId.trim());
    const selected = Boolean(
      input?.selectedConnectionId?.trim() && connection.id === input.selectedConnectionId.trim(),
    );
    const inBody = bodyIds.has(connection.id);
    // A product path that is not the picker must not steal prelude duty.
    if (inBody && !picker && !live && !selected) continue;
    let score = 1;
    if (picker) score += 8;
    if (live) score += 6;
    if (selected) score += 4;
    if (inBody && !picker && !live) score -= 3;
    if (!best || score > best.score) {
      best = {
        connectionId: connection.id,
        score,
        nav,
        label: destTitle || connection.label || "recorded path",
      };
    }
  }
  if (!best || best.score < 1) return undefined;
  return {
    entryPath: best.nav,
    sourceConnectionId: best.connectionId,
    sourceLabel: best.label,
  };
}

/** Flow to screenshot in each locale — not the picker-open recording when both exist. */
export function localeLoopBodyFlowId(
  map: AppMap,
  preludeConnectionId?: string,
): string | undefined {
  const flows = Object.values(map.flows).filter((flow) => flow.connectionIds.length > 0);
  const distinct = preludeConnectionId
    ? flows.find((flow) => flow.connectionIds.some((id) => id !== preludeConnectionId))
    : undefined;
  return distinct?.id ?? flows[0]?.id ?? Object.values(map.flows)[0]?.id;
}

export function applyRecordedLocalePrelude(
  scope: LocaleRunScope,
  prelude: RecordedLocalePrelude | undefined,
  mode: "fill" | "replace" = "fill",
): LocaleRunScope {
  if (!prelude?.entryPath.length && !prelude?.languagePath?.length) return scope;
  if (mode === "fill" && (scope.entryPath?.length || scope.languagePath?.length)) return scope;
  return {
    ...scope,
    entryPath: prelude.entryPath,
    ...(prelude.languagePath?.length
      ? { languagePath: prelude.languagePath }
      : mode === "replace"
        ? { languagePath: undefined }
        : {}),
  };
}

function navStepsToRecipe(steps: LocaleNavStep[] | undefined, app?: string): RecipeStep[] {
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
      if (!app) throw new Error("relaunch requires scope.app");
      out.push({ kind: "app", action: "open", app, relaunch: true });
      continue;
    }
    if (step.kind === "openApp") {
      const target = step.app?.trim() || app;
      if (!target) throw new Error("openApp requires step.app or scope.app");
      out.push({
        kind: "app",
        action: "open",
        app: target,
        relaunch: step.relaunch === true,
      });
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
    else throw new Error("locale nav tap requires identifier, label, or text");
  }
  return out;
}

export function composeLocaleRunRecipes(input: {
  body: Recipe;
  scope: LocaleRunScope;
  batchId: string;
}): { root: Recipe; graph: Record<string, Recipe> } {
  const scope = input.scope;
  const app = scope.app?.trim();
  const at = Date.now();
  const prelude: RecipeStep[] = [];
  if (app) {
    prelude.push({
      kind: "app",
      action: "open",
      app,
      relaunch: scope.relaunch !== false,
    });
    prelude.push({ kind: "sleep", ms: 1200 });
  }
  prelude.push(...navStepsToRecipe(scope.entryPath, app));
  prelude.push(...navStepsToRecipe(scope.languagePath, app));

  const tapIdentifier: Recipe = {
    id: "__locale_tap_identifier",
    title: "Tap locale by identifier",
    source: "custom",
    steps: [{ kind: "tap", target: { identifier: "{{locale_identifier}}" } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapLabel: Recipe = {
    id: "__locale_tap_label",
    title: "Tap locale by label",
    source: "custom",
    steps: [{ kind: "tap", target: { label: "{{locale_label}}" } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapText: Recipe = {
    id: "__locale_tap_text",
    title: "Tap locale by text",
    source: "custom",
    steps: [{ kind: "tap", target: { text: "{{locale_text}}" } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapLabelOrText: Recipe = {
    id: "__locale_tap_label_or_text",
    title: "Tap locale by label or text",
    source: "custom",
    steps: [
      {
        kind: "branch",
        input: "{{locale_label}}",
        operator: "not-equals",
        expected: NONE,
        thenRecipeId: "__locale_tap_label",
        elseRecipeId: "__locale_tap_text",
      },
    ],
    createdAt: at,
    updatedAt: at,
  };

  const select: RecipeStep[] = [
    {
      kind: "branch",
      input: "{{locale_identifier}}",
      operator: "not-equals",
      expected: NONE,
      thenRecipeId: "__locale_tap_identifier",
      elseRecipeId: "__locale_tap_label_or_text",
    },
    { kind: "sleep", ms: 900 },
  ];

  const bodySteps: RecipeStep[] = [];
  if (scope.screenshotEachLocale !== false) {
    bodySteps.push({ kind: "screenshot", caption: "locale:{{locale}} before body" });
  }
  bodySteps.push({ kind: "module", recipeId: input.body.id });
  if (scope.screenshotEachLocale !== false) {
    bodySteps.push({ kind: "screenshot", caption: "locale:{{locale}} after body" });
  }

  const restoreSteps: RecipeStep[] = [];
  if (scope.restoreAfterEach && scope.restoreLocale) {
    restoreSteps.push(...navStepsToRecipe(scope.languagePath, app));
    const option = optionForLocale(scope, scope.restoreLocale);
    restoreSteps.push({
      kind: "tap",
      target: option.identifier
        ? { identifier: option.identifier }
        : option.label
          ? { label: option.label }
          : option.text
            ? { text: option.text }
            : { label: scope.restoreLocale },
    });
    restoreSteps.push({ kind: "sleep", ms: 700 });
  }

  const root: Recipe = {
    id: `locale-run-${input.batchId}`,
    title: `${input.body.title} · locales`,
    description: `Locale matrix over ${input.body.id}`,
    source: "custom",
    steps: [...prelude, ...select, ...bodySteps, ...restoreSteps],
    createdAt: at,
    updatedAt: at,
  };

  return {
    root,
    graph: {
      [root.id]: root,
      [input.body.id]: structuredClone(input.body),
      [tapIdentifier.id]: tapIdentifier,
      [tapLabel.id]: tapLabel,
      [tapText.id]: tapText,
      [tapLabelOrText.id]: tapLabelOrText,
    },
  };
}

export async function prepareLocaleRunMatrix(
  scope: LocaleRunScope,
  seed?: number,
): Promise<{
  locales: string[];
  matrix: PreparedRunMatrix;
}> {
  const locales = normalizeLocales(scope.locales);
  const labels: string[] = [];
  const identifiers: string[] = [];
  const texts: string[] = [];
  for (const locale of locales) {
    const option = optionForLocale(scope, locale);
    labels.push(option.label?.trim() || NONE);
    identifiers.push(option.identifier?.trim() || NONE);
    texts.push(option.text?.trim() || NONE);
  }

  const restoreAtEnd = scope.restoreAtEnd !== false && scope.restoreLocale?.trim();
  const restore = restoreAtEnd ? scope.restoreLocale!.trim() : undefined;
  if (restore && locales[locales.length - 1] !== restore) {
    locales.push(restore);
    const option = optionForLocale(scope, restore);
    labels.push(option.label?.trim() || restore);
    identifiers.push(option.identifier?.trim() || NONE);
    texts.push(option.text?.trim() || NONE);
  }

  const matrix = await prepareRunMatrix({
    strategy: "zip",
    seed,
    maxCases: 250,
    variables: [
      { id: "locale", name: "locale", scope: "shared", source: "list", values: locales },
      {
        id: "locale_label",
        name: "locale_label",
        scope: "shared",
        source: "list",
        values: labels,
      },
      {
        id: "locale_identifier",
        name: "locale_identifier",
        scope: "shared",
        source: "list",
        values: identifiers,
      },
      {
        id: "locale_text",
        name: "locale_text",
        scope: "shared",
        source: "list",
        values: texts,
      },
    ],
  });

  return { locales, matrix };
}

export async function startLocaleRecipeRun(input: LocaleRunRequest): Promise<LocaleRunBatch> {
  const recipeId = requiredText(input.recipeId, "recipeId");
  const targetId = requiredText(input.targetId, "targetId");
  const body = input.compiledBody ?? (await readRecipe(recipeId));
  if (!body) throw new Error(`recipe not found: ${recipeId}`);
  const scope = completeTaughtLocaleScope(input.scope);
  if (!scope.entryPath?.length && !scope.languagePath?.length) {
    throw new Error("Record how you open this list");
  }

  const batchId = randomUUID();
  const prepared = await prepareLocaleRunMatrix(scope, input.seed);
  const { root, graph: seedGraph } = composeLocaleRunRecipes({
    body,
    scope,
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
  const title = input.title?.trim() || `${body.title} · locales`;

  const safeMatrix = redactRunMatrix(prepared.matrix, [
    {
      id: "locale",
      name: "locale",
      scope: "shared",
      source: "list",
      values: prepared.locales,
    },
  ]);

  const jobs = prepared.matrix.cases.map((item) => {
    const locale = item.values.locale ?? `case-${item.index + 1}`;
    const enqueue: EnqueueJobInput = {
      recipe: root.id,
      title: `${title} · ${locale}`,
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
      caseCount: prepared.matrix.cases.length,
      projectId,
      ownerId,
      artifacts: [
        {
          kind: "frozen-inputs",
          capturedAt: prepared.matrix.createdAt,
          data: {
            matrixId: prepared.matrix.id,
            localeRunBatchId: batchId,
            seed: prepared.matrix.seed,
            caseIndex: item.index,
            caseCount: prepared.matrix.cases.length,
            locale,
            values: safeMatrix.cases[item.index]?.values ?? item.values,
            provenance: safeMatrix.cases[item.index]?.provenance ?? item.provenance,
            kind: "locale-matrix",
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
    locales: prepared.locales,
    matrix: safeMatrix,
    jobs,
    composedRecipeId: root.id,
  };
}

export function defaultGrokLocaleScope(locales: string[]): LocaleRunScope {
  const normalized = normalizeLocales(locales);
  const profile = listLanguageProfilesSync().find((item) => item.id === "grok-ios");
  if (!profile) {
    return {
      locales: normalized,
      app: "ai.x.GrokApp",
      relaunch: true,
      entryPath: [
        { kind: "tap", target: { identifier: "sidebar.open.button" } },
        { kind: "wait", ms: 500 },
        { kind: "tap", target: { label: "Settings" } },
        { kind: "wait", ms: 700 },
      ],
      languagePath: [
        { kind: "tap", target: { label: "App Language" } },
        { kind: "wait", ms: 600 },
      ],
      languageOptions: Object.fromEntries(normalized.map((locale) => [locale, { label: locale }])),
      restoreLocale: "en",
      restoreAtEnd: true,
      screenshotEachLocale: true,
    };
  }
  return {
    locales: normalized,
    app: profile.app,
    relaunch: true,
    entryPath: structuredClone(profile.entryPath) as LocaleNavStep[],
    languagePath: structuredClone(profile.languagePath) as LocaleNavStep[],
    languageOptions: resolveLanguageOptions(profile, normalized),
    restoreLocale: profile.defaultLocale ?? "en",
    restoreAtEnd: true,
    screenshotEachLocale: true,
  };
}

export function localeRunDigest(scope: LocaleRunScope, recipeId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ recipeId, scope }))
    .digest("hex")
    .slice(0, 16);
}
