import assert from "node:assert/strict";
import test from "node:test";
import type { Recipe } from "./recipes.js";
import type { AppMap, AppMapEntity, Connection, Screen } from "@relay/protocol";
import {
  composeOptionRunRecipes,
  resolveVariableApply,
  assertOptionSandwichReady,
  navStepsToRecipe,
  stabilizeOptionIds,
  prepareOptionRunMatrix,
  optimizeSequentialAppLocaleRestore,
  expectedRecipeScreenshotCount,
  assertRequestedCaseValues,
  type OptionRunSet,
} from "./option-run.js";
import { preflightAppMapCombine } from "./app-map-combine-preflight.js";

test("state navigation keeps translated fallback labels", () => {
  assert.deepEqual(
    navStepsToRecipe([
      {
        kind: "tap",
        target: { label: "App Language" },
        fallbackTargets: [{ label: "Lingua App" }],
      },
    ]),
    [
      {
        kind: "tap",
        target: { label: "App Language" },
        fallbackTargets: [{ label: "Lingua App" }],
      },
    ],
  );
});

const body: Recipe = {
  id: "checkout",
  title: "Checkout",
  source: "custom",
  steps: [{ kind: "screenshot", caption: "body" }],
  createdAt: 1,
  updatedAt: 1,
};

const languages: OptionRunSet = {
  id: "languages",
  name: "Language",
  kind: "language",
  apply: {
    kind: "list",
    entryPath: [{ kind: "tap", target: { label: "Profile" } }],
    pickerPath: [{ kind: "tap", target: { text: "Language" } }],
  },
  options: [
    { id: "en", identifier: "lang.en" },
    { id: "de", label: "Deutsch" },
  ],
};

const locations: OptionRunSet = {
  id: "locations",
  name: "Location",
  kind: "location",
  apply: {
    kind: "list",
    entryPath: [{ kind: "tap", target: { label: "City" } }],
  },
  options: [
    { id: "nyc", label: "New York" },
    { id: "sf", label: "San Francisco" },
  ],
};

test("two option sets cartesian expand to four worlds", async () => {
  const matrix = await prepareOptionRunMatrix({
    sets: [languages, locations],
    strategy: "cartesian",
  });
  assert.equal(matrix.cases.length, 4);
  assert.equal(matrix.strategy, "cartesian");
  const keys = matrix.cases
    .map((item) => `${item.values.languages}+${item.values.locations}`)
    .sort();
  assert.deepEqual(keys, ["de+nyc", "de+sf", "en+nyc", "en+sf"]);
});

test("campaign resume refuses an index whose reviewed locale value moved", async () => {
  const matrix = await prepareOptionRunMatrix({ sets: [languages], strategy: "cartesian" }, 42);
  const reviewed = matrix.cases[0]!.values.languages!;
  const changed = reviewed === "en" ? "de" : "en";
  assert.doesNotThrow(() =>
    assertRequestedCaseValues(matrix, new Set([0]), { 0: { languages: reviewed } }),
  );
  assert.throws(
    () => assertRequestedCaseValues(matrix, new Set([0]), { 0: { languages: changed } }),
    /case 1 changed since the pilot/,
  );
});

test("zip pairs option sets of equal length", async () => {
  const matrix = await prepareOptionRunMatrix({
    sets: [languages, locations],
    strategy: "zip",
  });
  assert.equal(matrix.cases.length, 2);
});

test("a full 41-locale sweep is not rejected by a small UI-era cap", async () => {
  const locales: OptionRunSet = {
    ...languages,
    options: Array.from({ length: 41 }, (_, index) => ({ id: `locale-${index + 1}` })),
  };
  const matrix = await prepareOptionRunMatrix({ sets: [locales], strategy: "zip" });
  assert.equal(matrix.cases.length, 41);
});

test("a single app-locale campaign restores once by scheduling its baseline last", async () => {
  const language: OptionRunSet = {
    id: "language",
    name: "Language",
    kind: "language",
    apply: { kind: "appLocale", app: "com.example" },
    options: [{ id: "en" }, { id: "it" }, { id: "pt-BR" }],
    restoreId: "en",
  };
  const request = { sets: [language], strategy: "zip" as const };
  const matrix = await prepareOptionRunMatrix(request);
  const optimized = optimizeSequentialAppLocaleRestore(request, matrix);

  assert.equal(optimized.optimized, true);
  assert.equal(optimized.request.restoreAtEnd, false);
  assert.deepEqual(
    optimized.matrix.cases.map((item) => item.values.language),
    ["it", "pt-BR", "en"],
  );
  assert.deepEqual(
    optimized.matrix.cases.map((item) => item.index),
    [0, 1, 2],
  );
});

test("restore optimization never rewrites list or multi-variable campaigns", async () => {
  const matrix = await prepareOptionRunMatrix({ sets: [languages], strategy: "zip" });
  const result = optimizeSequentialAppLocaleRestore(
    { sets: [{ ...languages, restoreId: "en" }], strategy: "zip" },
    matrix,
  );
  assert.equal(result.optimized, false);
  assert.equal(result.request.restoreAtEnd, undefined);
  assert.deepEqual(result.matrix.cases, matrix.cases);
});

test("pairwise covers every pair without constructing the full product", async () => {
  const themes: OptionRunSet = {
    id: "themes",
    name: "Theme",
    kind: "theme",
    apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Theme" } }] },
    options: [{ id: "light" }, { id: "dark" }, { id: "system" }],
  };
  const matrix = await prepareOptionRunMatrix({
    sets: [languages, locations, themes],
    strategy: "pairwise",
  });
  assert.equal(matrix.strategy, "pairwise");
  assert.ok(matrix.cases.length < 12);
  for (const item of matrix.cases) {
    assert.ok(item.values.languages);
    assert.ok(item.values.locations);
    assert.ok(item.values.themes);
    assert.ok(`${item.values.languages_label}`.length > 0);
  }
});

test("location opener is recorded, not Grok Settings", () => {
  const { root } = composeOptionRunRecipes({
    body,
    request: { sets: [locations], screenshotEach: true },
    batchId: "loc-1",
  });
  const taps = root.steps
    .filter((step) => step.kind === "tap")
    .map((step) =>
      "target" in step
        ? (step.target.identifier ?? step.target.label ?? step.target.text ?? "")
        : "",
    );
  assert.ok(taps.includes("City"));
  assert.ok(!taps.some((target) => /sidebar\.settings|app language/i.test(target)));
});

test("a test that owns screenshot evidence gets no generic before or after captures", () => {
  const { root } = composeOptionRunRecipes({
    body,
    request: { sets: [locations], screenshotEach: true },
    batchId: "owned-evidence",
  });
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "screenshot"),
    [],
  );
});

test("an Android app-language Variable uses stable locale ids instead of picker labels", () => {
  const { root } = composeOptionRunRecipes({
    body,
    request: {
      sets: [
        {
          id: "language",
          name: "Language",
          kind: "language",
          apply: { kind: "appLocale", app: "ai.x.grok" },
          options: [{ id: "en" }, { id: "it" }],
          restoreId: "en",
        },
      ],
      screenshotEach: true,
    },
    batchId: "app-locale",
  });
  assert.deepEqual(root.steps.slice(0, 3), [
    { kind: "app", action: "set-locale", app: "ai.x.grok", locale: "{{language}}" },
    { kind: "app", action: "open", app: "ai.x.grok", relaunch: true },
    { kind: "sleep", ms: 1200 },
  ]);
  assert.deepEqual(root.steps.slice(-3), [
    { kind: "app", action: "set-locale", app: "ai.x.grok", locale: "en" },
    { kind: "app", action: "open", app: "ai.x.grok", relaunch: true },
    { kind: "sleep", ms: 1200 },
  ]);
});

test("an appLocale Variable stays on screen only when relaunch is explicitly false", () => {
  const { root } = composeOptionRunRecipes({
    body,
    request: {
      sets: [
        {
          id: "language",
          name: "Language",
          kind: "language",
          apply: { kind: "appLocale", app: "ai.x.grok", relaunch: false },
          options: [{ id: "he" }],
          restoreId: "en",
        },
      ],
      screenshotEach: false,
    },
    batchId: "app-locale-stay",
  });
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "app"),
    [
      { kind: "app", action: "set-locale", app: "ai.x.grok", locale: "{{language}}" },
      { kind: "app", action: "set-locale", app: "ai.x.grok", locale: "en" },
    ],
  );
});

test("a stay appLocale Variable re-proves the Test destination when it has identity", () => {
  const destination: Recipe = {
    ...body,
    id: "data-controls",
    steps: [
      {
        kind: "expect-screen",
        id: "data-controls",
        screenId: "data-controls",
        screenTitle: "Data Controls",
        fingerprint: "a".repeat(64),
        recovery: { strategy: "back" },
      },
    ],
  };
  const { root } = composeOptionRunRecipes({
    body: destination,
    request: {
      sets: [
        {
          id: "language",
          name: "Language",
          kind: "language",
          apply: { kind: "appLocale", app: "ai.x.grok", relaunch: false },
          options: [{ id: "he" }],
        },
      ],
      screenshotEach: false,
    },
    batchId: "app-locale-stay-proof",
  });
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "expect-screen"),
    [
      {
        kind: "expect-screen",
        id: "data-controls-stay",
        screenId: "data-controls",
        screenTitle: "Data Controls",
        fingerprint: "a".repeat(64),
      },
    ],
  );
});

test("a mapped suite cold-launches once then warms every generated setup", () => {
  const setup: Recipe = {
    ...body,
    id: "mapped-setup",
    steps: [
      { kind: "app", action: "open", app: "ai.x.grok", relaunch: true },
      {
        kind: "expect-screen",
        id: "relay-source-settings",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "a".repeat(64),
      },
    ],
  };
  const combined: Recipe = {
    ...body,
    id: "mapped-combined",
    steps: [{ kind: "module", recipeId: setup.id }],
  };
  const { root, graph } = composeOptionRunRecipes({
    body: combined,
    bodyGraph: { [combined.id]: combined, [setup.id]: setup },
    request: { sets: [], app: "ai.x.grok", screenshotEach: false },
    batchId: "warm-suite",
  });
  assert.deepEqual(root.steps.slice(0, 2), [
    { kind: "app", action: "open", app: "ai.x.grok", relaunch: true },
    { kind: "sleep", ms: 1200 },
  ]);
  assert.deepEqual(graph[setup.id]?.steps[0], {
    kind: "app",
    action: "open",
    app: "ai.x.grok",
    relaunch: false,
  });
  const source = graph[setup.id]?.steps[1];
  assert.equal(source?.kind === "expect-screen" ? source.recovery : undefined, undefined);
});

test("a list Variable restores its saved row through the recorded sandwich", () => {
  const language: OptionRunSet = {
    id: "language",
    name: "Language",
    kind: "language",
    apply: {
      kind: "list",
      entryPath: [{ kind: "tap", target: { identifier: "settings.profile" } }],
      pickerPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      exitPath: [{ kind: "back" }],
    },
    options: [
      {
        id: "en",
        identifier: "language.en",
        label: "English",
        text: "English (United States)",
      },
      { id: "it", identifier: "language.it" },
    ],
    restoreId: "en",
  };
  const { root } = composeOptionRunRecipes({
    body,
    request: { sets: [language], screenshotEach: false },
    batchId: "list-restore",
  });
  const bodyIndex = root.steps.findIndex(
    (step) => step.kind === "module" && step.recipeId === body.id,
  );
  assert.ok(bodyIndex >= 0);
  assert.deepEqual(root.steps.slice(bodyIndex + 1), [
    { kind: "tap", target: { identifier: "settings.profile" } },
    { kind: "tap", target: { identifier: "settings.language" } },
    {
      kind: "tap",
      target: { identifier: "language.en" },
      fallbackTargets: [{ label: "English" }, { text: "English (United States)" }],
    },
    { kind: "sleep", ms: 900 },
    { kind: "key", key: "back" },
  ]);
});

test("list restore is omitted when a matrix explicitly leaves state changed", () => {
  const language: OptionRunSet = {
    id: "language",
    name: "Language",
    kind: "language",
    apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Language" } }] },
    options: [
      { id: "en", identifier: "language.en" },
      { id: "it", identifier: "language.it" },
    ],
    restoreId: "en",
  };
  const { root } = composeOptionRunRecipes({
    body,
    request: { sets: [language], screenshotEach: false, restoreAtEnd: false },
    batchId: "no-list-restore",
  });
  assert.ok(
    !root.steps.some((step) => step.kind === "tap" && step.target.identifier === "language.en"),
  );
});

test("list restore requires a saved row target instead of tapping an opaque row id", () => {
  const language: OptionRunSet = {
    id: "language",
    name: "Language",
    kind: "language",
    apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Language" } }] },
    options: [{ id: "en" }, { id: "it", identifier: "language.it" }],
    restoreId: "en",
  };
  assert.throws(
    () =>
      composeOptionRunRecipes({
        body,
        request: { sets: [language], screenshotEach: false },
        batchId: "invalid-list-restore",
      }),
    /restore option.*needs an identifier, label, or text/i,
  );
});

test("seven app languages × ten mapped screens declares exactly 70 screenshots", async () => {
  const tenScreens: Recipe = {
    ...body,
    id: "ten-screens",
    steps: [
      { kind: "screenshot", caption: "Ask" },
      { kind: "screenshot", caption: "Sidebar" },
      { kind: "screenshot", caption: "Settings" },
      {
        kind: "tour",
        mappedStopsOnly: true,
        screenshot: true,
        fallbackStops: Array.from({ length: 7 }, (_, index) => ({
          label: `Settings ${index + 1}`,
        })),
      },
    ],
  };
  const language: OptionRunSet = {
    id: "language",
    name: "Language",
    kind: "language",
    apply: { kind: "appLocale", app: "ai.x.grok" },
    options: ["en", "ar", "de", "es", "fr", "it", "pt-BR"].map((id) => ({ id })),
  };
  const matrix = await prepareOptionRunMatrix({ sets: [language], strategy: "cartesian" });
  const { root, graph } = composeOptionRunRecipes({
    body: tenScreens,
    request: { sets: [language], screenshotEach: true },
    batchId: "seventy",
  });
  assert.equal(matrix.cases.length, 7);
  assert.equal(expectedRecipeScreenshotCount(root, graph), 10);
  assert.equal(matrix.cases.length * expectedRecipeScreenshotCount(root, graph)!, 70);
});

test("preflight counts an exact tour's captured origin", () => {
  const root: Recipe = {
    ...body,
    id: "captured-origin",
    steps: [
      {
        kind: "tour",
        mappedStopsOnly: true,
        screenshot: true,
        captureOrigin: true,
        fallbackStops: [],
      },
    ],
  };
  assert.equal(expectedRecipeScreenshotCount(root, { [root.id]: root }), 1);
});

test("preflight leaves an account-dependent tour count live", () => {
  const root: Recipe = {
    ...body,
    id: "optional-offer",
    steps: [
      {
        kind: "tour",
        mappedStopsOnly: true,
        fallbackStops: [{ label: "Buy More", optional: true }],
      },
    ],
  };
  assert.equal(expectedRecipeScreenshotCount(root, { [root.id]: root }), undefined);
});

const at = 1;
const scope = { organizationId: "org", projectId: "p", appMapId: "map-1" };
function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}
function screen(id: string, title: string): Screen {
  return {
    ...entity(id),
    title,
    identity: { schemaVersion: 1, fingerprint: id.padEnd(64, "a") },
    variantIds: [],
  };
}

function sandwichMap(): AppMap {
  const openList: Connection = {
    ...entity("open-cities"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "cities" },
    state: "ready",
    actions: [
      {
        id: "open",
        kind: "steps",
        steps: [{ kind: "tap", target: { label: "Profile" } }],
      },
    ],
  };
  const leaveList: Connection = {
    ...entity("leave-cities"),
    fromScreenId: "cities",
    destination: { kind: "screen", screenId: "home" },
    state: "ready",
    actions: [{ id: "back", kind: "back" }],
  };
  return {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org",
    projectId: "p",
    name: "Store",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      home: screen("home", "Home"),
      cities: screen("cities", "Cities"),
      checkout: screen("checkout", "Checkout"),
    },
    screenVariants: {},
    connections: { [openList.id]: openList, [leaveList.id]: leaveList },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {
      buy: {
        ...entity("buy"),
        name: "Buy",
        startScreenId: "home",
        connectionIds: [],
      },
    },
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("In → select → Out → work; Out is back before the body", () => {
  const map = sandwichMap();
  const set: OptionRunSet = {
    id: "locations",
    name: "Location",
    kind: "location",
    apply: {
      kind: "list",
      inConnectionId: "open-cities",
      outConnectionId: "leave-cities",
    },
    options: [{ id: "nyc", label: "New York" }],
  };
  const { root } = composeOptionRunRecipes({
    body,
    request: { sets: [set], map, screenshotEach: true },
    batchId: "sandwich-1",
  });
  const kinds = root.steps.map((step) => {
    if (step.kind === "tap") {
      return `tap:${step.target.label ?? step.target.text ?? step.target.identifier ?? ""}`;
    }
    if (step.kind === "key") return `key:${step.key}`;
    if (step.kind === "module") return `module:${step.recipeId}`;
    if (step.kind === "branch") return "select";
    return step.kind;
  });
  const profile = kinds.indexOf("tap:Profile");
  const select = kinds.indexOf("select");
  const back = kinds.indexOf("key:back");
  const work = kinds.indexOf("module:checkout");
  assert.ok(profile >= 0 && select > profile && back > select && work > back);
  assert.ok(!kinds.some((step) => /sidebar|app language/i.test(step)));
});

test("an explicit empty selection never expands to every saved option", async () => {
  const set: OptionRunSet = {
    id: "language",
    name: "Language",
    kind: "language",
    apply: { kind: "appLocale", app: "com.example" },
    options: [
      { id: "en", label: "English" },
      { id: "it", label: "Italiano" },
    ],
  };
  await assert.rejects(
    prepareOptionRunMatrix({ sets: [set], selected: { language: [] } }),
    /needs at least one option/,
  );
});

test("combine preflight reports the exact device and screenshot expansion", async () => {
  const base = sandwichMap();
  for (const screen of Object.values(base.screens)) delete screen.identity;
  const variable = {
    ...entity("language"),
    name: "Language",
    kind: "language" as const,
    apply: { kind: "appLocale" as const, app: "com.example" },
    options: [
      { id: "en", label: "English" },
      { id: "it", label: "Italiano" },
    ],
    restoreId: "en",
  };
  const work = {
    ...entity("settings-tour"),
    name: "Settings coverage",
    kind: "scenario" as const,
    intentSchemaVersion: 1 as const,
    steps: [
      {
        id: "settings-check",
        kind: "script" as const,
        intent: "Check Settings",
        capture: true,
        binding: { status: "resolved" as const, kind: "script" as const, source: "return true" },
      },
    ],
    capture: { mode: "every-screen" as const },
  };
  const combine = {
    ...entity("language-x-settings"),
    name: "Language × Settings",
    variableIds: [variable.id],
    testIds: [work.id],
    selected: { [variable.id]: ["en", "it"] },
    strategy: "cartesian" as const,
    cellRuntimeProfiles: [
      { testId: work.id, values: { [variable.id]: "en" }, targetProfileId: "pixel-en" },
      { testId: work.id, values: { [variable.id]: "it" }, targetProfileId: "pixel-it" },
    ],
  };
  const map: AppMap = {
    ...base,
    connections: {
      ...base.connections,
      "open-cities": { ...base.connections["open-cities"]!, label: "Profile" },
    },
    variables: { [variable.id]: variable },
    tests: { [work.id]: work },
    combines: { [combine.id]: combine },
  };

  const preflight = await preflightAppMapCombine(map, combine);
  assert.equal(preflight.ok, true, JSON.stringify(preflight.blockers));
  assert.equal(preflight.cells.length, 2);
  assert.ok(preflight.cells.every((cell) => cell.binding === "bound"));
  assert.equal(preflight.worlds, 2);
  assert.equal(preflight.deviceRuns, 2);
  assert.equal(preflight.checks, 2);
  assert.equal(preflight.expectedScreenshots, 2);
  assert.equal(preflight.variables[0]?.selectedCount, 2);
});

test("combine preflight previews the requested pilot selection", async () => {
  const base = sandwichMap();
  for (const screen of Object.values(base.screens)) delete screen.identity;
  const variable = {
    ...entity("language"),
    name: "Language",
    kind: "language" as const,
    apply: { kind: "appLocale" as const, app: "com.example" },
    options: [
      { id: "en", label: "English" },
      { id: "it", label: "Italian" },
    ],
  };
  const work = {
    ...entity("settings-tour"),
    name: "Settings coverage",
    kind: "scenario" as const,
    intentSchemaVersion: 1 as const,
    steps: [
      {
        id: "settings-check",
        kind: "script" as const,
        intent: "Check Settings",
        binding: { status: "resolved" as const, kind: "script" as const, source: "return true" },
      },
    ],
  };
  const combine = {
    ...entity("language-x-settings"),
    name: "Language × Settings",
    variableIds: [variable.id],
    testIds: [work.id],
    selected: { [variable.id]: ["en", "it"] },
    cellRuntimeProfiles: [
      { testId: work.id, values: { [variable.id]: "en" }, targetProfileId: "pixel-en" },
      { testId: work.id, values: { [variable.id]: "it" }, targetProfileId: "pixel-it" },
    ],
  };
  const map: AppMap = {
    ...base,
    variables: { [variable.id]: variable },
    tests: { [work.id]: work },
    combines: { [combine.id]: combine },
  };

  const preflight = await preflightAppMapCombine(map, combine, {
    selected: { [variable.id]: ["it"] },
  });
  assert.equal(preflight.worlds, 1);
  assert.equal(preflight.deviceRuns, 1);
  assert.equal(preflight.variables[0]?.selectedCount, 1);
});

test("40 screens across 40 locales stay 40 device runs, not 1600 locale switches", async () => {
  const base = sandwichMap();
  for (const screen of Object.values(base.screens)) delete screen.identity;
  const variable = {
    ...entity("language"),
    name: "Language",
    kind: "language" as const,
    apply: { kind: "appLocale" as const, app: "com.example" },
    options: Array.from({ length: 40 }, (_, index) => ({
      id: `locale-${index + 1}`,
      label: `Locale ${index + 1}`,
    })),
  };
  const work = {
    ...entity("relay-40"),
    name: "Relay 40",
    kind: "scenario" as const,
    intentSchemaVersion: 1 as const,
    steps: Array.from({ length: 40 }, (_, index) => ({
      id: `check-${index + 1}`,
      kind: "script" as const,
      intent: `Check screen ${index + 1}`,
      capture: true,
      binding: { status: "resolved" as const, kind: "script" as const, source: "return true" },
    })),
  };
  const combine = {
    ...entity("language-x-relay-40"),
    name: "Language × Relay 40",
    variableIds: [variable.id],
    testIds: [work.id],
    strategy: "cartesian" as const,
    cellRuntimeProfiles: variable.options.map((option) => ({
      testId: work.id,
      values: { [variable.id]: option.id },
      targetProfileId: `pixel-${option.id}`,
    })),
  };
  const map: AppMap = {
    ...base,
    variables: { [variable.id]: variable },
    tests: { [work.id]: work },
    combines: { [combine.id]: combine },
  };

  const preflight = await preflightAppMapCombine(map, combine);
  assert.equal(preflight.ok, true, JSON.stringify(preflight.blockers));
  assert.equal(preflight.worlds, 40);
  assert.equal(preflight.deviceRuns, 40);
  assert.equal(preflight.checks, 40);
  assert.equal(preflight.expectedScreenshots, 1_600);
  assert.match(preflight.formula, /Language × Relay 40/);
});

test("combine preflight blocks a deliberately empty Variable", async () => {
  const base = sandwichMap();
  for (const screen of Object.values(base.screens)) delete screen.identity;
  const variable = {
    ...entity("language"),
    name: "Language",
    kind: "language" as const,
    apply: { kind: "appLocale" as const, app: "com.example" },
    options: [{ id: "en", label: "English" }],
  };
  const work = {
    ...entity("settings-tour"),
    name: "Settings coverage",
    kind: "scenario" as const,
    intentSchemaVersion: 1 as const,
    steps: [
      {
        id: "settings-check",
        kind: "script" as const,
        intent: "Check Settings",
        binding: { status: "resolved" as const, kind: "script" as const, source: "return true" },
      },
    ],
  };
  const combine = {
    ...entity("language-x-settings"),
    name: "Language × Settings",
    variableIds: [variable.id],
    testIds: [work.id],
    selected: { [variable.id]: [] },
  };
  const preflight = await preflightAppMapCombine(
    {
      ...base,
      variables: { [variable.id]: variable },
      tests: { [work.id]: work },
      combines: { [combine.id]: combine },
    },
    combine,
  );
  assert.equal(preflight.ok, false);
  assert.ok(preflight.blockers.some((item) => item.code === "empty-selection"));
});

test("empty Out still runs; language without In does not invent Grok nav", () => {
  const language: OptionRunSet = {
    id: "languages",
    name: "Language",
    kind: "language",
    apply: { kind: "list" },
    options: [{ id: "en", identifier: "lang.en" }],
  };
  const resolved = resolveVariableApply(language);
  assert.equal(resolved.entry.length, 0);
  assert.equal(resolved.exit.length, 0);
  assert.throws(() => assertOptionSandwichReady(language), /Record how you open this list/);
  const grokFilled = resolveVariableApply(language, undefined, { preset: "grok" });
  assert.ok(grokFilled.entry.length > 0);
  const location: OptionRunSet = {
    id: "locations",
    name: "Location",
    kind: "location",
    apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "City" } }] },
    options: [{ id: "sf", label: "SF" }],
  };
  const { root } = composeOptionRunRecipes({
    body,
    request: { sets: [location], screenshotEach: false },
    batchId: "no-out",
  });
  assert.ok(root.steps.some((step) => step.kind === "module"));
  assert.ok(!root.steps.some((step) => step.kind === "key" && step.key === "back"));
});

test("stabilizeOptionIds slugs labels and never invents nav", () => {
  assert.deepEqual(
    stabilizeOptionIds([
      { id: "und", label: "New York" },
      { id: "de", identifier: "lang.de" },
    ]).map((row) => row.id),
    ["new-york", "de"],
  );
});

test("pickStepId splits one recording into In before pick and Out after", () => {
  const map = sandwichMap();
  map.connections["open-cities"] = {
    ...map.connections["open-cities"]!,
    actions: [
      {
        id: "demo",
        kind: "steps",
        steps: [
          { id: "tap-profile", kind: "tap", target: { label: "Profile" } },
          { id: "pick-en", kind: "tap", target: { label: "English" } },
          { id: "leave", kind: "key", key: "back" },
        ],
      },
    ],
  };
  const set: OptionRunSet = {
    id: "languages",
    name: "Language",
    kind: "language",
    apply: {
      kind: "list",
      inConnectionId: "open-cities",
      pickStepId: "pick-en",
      listScreenId: "cities",
    },
    options: [{ id: "en", label: "English" }],
  };
  const resolved = resolveVariableApply(set, map);
  assert.deepEqual(
    resolved.entry.map((step) => (step.kind === "tap" ? step.target.label : step.kind)),
    ["Profile"],
  );
  assert.deepEqual(
    resolved.exit.map((step) => (step.kind === "back" ? "back" : step.kind)),
    ["back"],
  );
  assert.throws(
    () =>
      assertOptionSandwichReady(
        {
          id: "locations",
          name: "Location",
          kind: "location",
          apply: {
            kind: "list",
            entryPath: [{ kind: "tap", target: { label: "City" } }],
            listScreenId: "cities",
          },
          options: [{ id: "nyc" }],
        },
        map,
        { startScreenId: "checkout" },
      ),
    /get back/i,
  );
});

test("toggle apply is rejected before enqueue", async () => {
  await assert.rejects(
    () =>
      prepareOptionRunMatrix({
        sets: [
          {
            id: "dark",
            name: "Appearance",
            kind: "toggle",
            apply: {
              kind: "toggle",
              target: { identifier: "appearance" },
              on: { label: "Dark" },
              off: { label: "Light" },
            },
            options: [{ id: "on" }, { id: "off" }],
          },
        ],
      }),
    /not runnable yet/i,
  );
});
