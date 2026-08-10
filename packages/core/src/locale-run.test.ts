import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyRecordedLocalePrelude,
  artifactLocale,
  composeLocaleRunRecipes,
  defaultGrokLocaleScope,
  evidenceFrameNames,
  exportLocaleRunPack,
  inferLocaleOptionsFromTeach,
  localeLoopBodyFlowId,
  localeNavFromRecipeSteps,
  localeRunScopeFromTeach,
  completeTaughtLocaleScope,
  prepareLocaleRunMatrix,
  recordedLocalePreludeFromMap,
  startLocaleRecipeRun,
  type LocaleRunScope,
} from "./locale-run.js";
import type { SnapshotNode } from "./device.js";
import type { Recipe } from "./recipes.js";
import type { AppMap, AppMapEntity, Connection, Screen } from "@relay/protocol";
import { saveRecipe } from "./recipes.js";
import { cancelJob, type TestJob } from "./session.js";
import { runWithOperationContext } from "./operation-context.js";

const body: Recipe = {
  id: "custom-settings-smoke",
  title: "Settings smoke",
  source: "custom",
  steps: [
    { kind: "screenshot", caption: "body" },
    { kind: "tap", target: { label: "Appearance" } },
  ],
  createdAt: 1,
  updatedAt: 1,
};

test("matrix packs omit automatic setup frames and enforce authored evidence count", () => {
  const job = {
    id: "seven-by-ten",
    artifacts: [
      {
        kind: "frozen-inputs",
        capturedAt: 1,
        data: { expectedScreenshots: 2 },
      },
    ],
    steps: [
      {
        frames: [
          { path: "frames/001.png", caption: "before · Set locale", capturedAt: 1 },
          { path: "frames/002.png", caption: "after · Set locale", capturedAt: 2 },
        ],
      },
      {
        frames: [
          { path: "frames/003.png", caption: "screen:Settings", capturedAt: 3 },
          { path: "frames/004.png", caption: "tour:Usage", capturedAt: 4 },
        ],
      },
    ],
  } as unknown as TestJob;

  assert.deepEqual([...evidenceFrameNames(job).names!], ["003.png", "004.png"]);
});

test("run-matrix exports use the language value as the case folder", () => {
  assert.equal(
    artifactLocale({ resolvedInputs: { language: "pt-BR" } } as unknown as TestJob),
    "pt-BR",
  );
});

test("composeLocaleRunRecipes wraps body with language switch and helpers", () => {
  const scope: LocaleRunScope = defaultGrokLocaleScope(["en", "pt-BR"]);
  const { root, graph } = composeLocaleRunRecipes({
    body,
    scope,
    batchId: "batch-1",
  });
  assert.equal(root.id, "locale-run-batch-1");
  assert.ok(root.steps.some((step) => step.kind === "app"));
  assert.ok(root.steps.some((step) => step.kind === "module" && step.recipeId === body.id));
  assert.ok(root.steps.some((step) => step.kind === "branch"));
  assert.ok(graph.__locale_tap_identifier);
  assert.ok(graph.__locale_tap_label);
  assert.ok(graph[body.id]);
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "screenshot").map((step) => step.kind),
    ["screenshot", "screenshot"],
  );
});

test("prepareLocaleRunMatrix zips locale fields and restores English at end", async () => {
  const prepared = await prepareLocaleRunMatrix(defaultGrokLocaleScope(["en", "pt-BR", "es"]), 42);
  // Profile adds restore-en at end; unknown "es" keeps tag as label fallback.
  assert.deepEqual(prepared.locales, ["en", "pt-BR", "es", "en"]);
  assert.equal(prepared.matrix.cases.length, 4);
  assert.equal(prepared.matrix.cases[1]!.values.locale, "pt-BR");
  assert.equal(prepared.matrix.cases[1]!.values.locale_label, "Português (Brasil)");
  assert.equal(prepared.matrix.cases[2]!.values.locale_label, "es");
  assert.equal(prepared.matrix.cases[3]!.values.locale, "en");
});

test("languageOptions can supply stable identifiers per locale", async () => {
  const prepared = await prepareLocaleRunMatrix({
    locales: ["en", "pt-BR"],
    languageOptions: {
      en: { identifier: "lang.en" },
      "pt-BR": { label: "Português" },
    },
    restoreAtEnd: false,
  });
  assert.equal(prepared.matrix.cases.length, 2);
  assert.equal(prepared.matrix.cases[0]!.values.locale_identifier, "lang.en");
  assert.equal(prepared.matrix.cases[0]!.values.locale_label, "-");
  assert.equal(prepared.matrix.cases[1]!.values.locale_label, "Português");
  assert.equal(prepared.matrix.cases[1]!.values.locale_identifier, "-");
});

const pickerNodes: SnapshotNode[] = [
  {
    type: "Cell",
    identifier: "lang.en",
    label: "English, English",
    hittable: true,
    enabled: true,
    visibleToUser: true,
    rect: { x: 400, y: 120, width: 320, height: 44 },
  },
  {
    type: "Cell",
    identifier: "lang.pt-BR",
    label: "Português (Brasil), Portuguese (Brazil)",
    hittable: true,
    enabled: true,
    visibleToUser: true,
    rect: { x: 400, y: 170, width: 320, height: 44 },
  },
  {
    type: "Cell",
    label: "Italiano, Italian",
    hittable: true,
    enabled: true,
    visibleToUser: true,
    rect: { x: 400, y: 220, width: 320, height: 44 },
  },
];

test("taught locale options do not invent Grok Settings nav", () => {
  const taught = localeRunScopeFromTeach({
    nodes: pickerNodes,
    examples: [{ locale: "en", identifier: "lang.en" }],
    screenshotEachLocale: true,
    restoreAtEnd: false,
  });
  assert.equal(taught.entryPath?.length ?? 0, 0);
  assert.equal(taught.languagePath?.length ?? 0, 0);
  assert.deepEqual(taught.languageOptions?.en, { identifier: "lang.en" });
  assert.equal(JSON.stringify(taught).includes("sidebar.settings.button"), false);
});

test("explicit Grok preset still fills picker nav", () => {
  const taught = completeTaughtLocaleScope(
    localeRunScopeFromTeach({
      nodes: pickerNodes,
      examples: [{ locale: "en", identifier: "lang.en" }],
      screenshotEachLocale: true,
      restoreAtEnd: false,
    }),
    { preset: "grok" },
  );
  assert.ok(taught.entryPath?.length || taught.languagePath?.length);
  const { root } = composeLocaleRunRecipes({
    body,
    scope: taught,
    batchId: "taught-nav",
  });
  const preludeTaps = root.steps
    .filter((step) => step.kind === "tap")
    .map((step) =>
      "target" in step
        ? (step.target.identifier ?? step.target.label ?? step.target.text ?? "")
        : "",
    );
  assert.ok(
    preludeTaps.some((target) => /app language|sidebar\.settings|sidebar\.open/i.test(target)),
    `expected picker nav taps before locale select, got ${JSON.stringify(preludeTaps)}`,
  );
});

test("localeNavFromRecipeSteps keeps semantic taps and drops screenshots", () => {
  const nav = localeNavFromRecipeSteps([
    { kind: "tap", target: { label: "Profile" } },
    { kind: "sleep", ms: 400 },
    { kind: "screenshot", caption: "settings" },
    { kind: "tap", target: { identifier: "settings.language" } },
    { kind: "app", action: "open", app: "com.apple.Preferences" },
  ]);
  assert.deepEqual(nav, [
    { kind: "tap", target: { label: "Profile" } },
    { kind: "wait", ms: 400 },
    { kind: "tap", target: { identifier: "settings.language" } },
    { kind: "openApp", app: "com.apple.Preferences" },
  ]);
});

const mapAt = 1_000;
const mapScope = { organizationId: "org-1", projectId: "project-1", appMapId: "store" };
function mapEntity(id: string): AppMapEntity {
  return { ...mapScope, id, createdAt: mapAt, updatedAt: mapAt };
}
function mapScreen(id: string, title: string): Screen {
  return {
    ...mapEntity(id),
    title,
    identity: { schemaVersion: 1, fingerprint: `${id}${"a".repeat(60)}`.slice(0, 64) },
    variantIds: [],
  };
}

function storeMap(): AppMap {
  const checkout: Connection = {
    ...mapEntity("open-checkout"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "checkout" },
    state: "ready",
    actions: [
      {
        id: "tap-bag",
        kind: "recorded",
        takeId: "take-1",
        takeRevision: 1,
        evidenceIds: [],
        steps: [{ kind: "tap", target: { label: "Bag" } }],
      },
    ],
  };
  const languages: Connection = {
    ...mapEntity("open-languages"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "languages" },
    label: "Open languages",
    state: "ready",
    actions: [
      {
        id: "open-picker",
        kind: "recorded",
        takeId: "take-2",
        takeRevision: 1,
        evidenceIds: [],
        steps: [
          { kind: "tap", target: { label: "Profile" } },
          { kind: "sleep", ms: 300 },
          { kind: "tap", target: { text: "Language" } },
        ],
      },
    ],
  };
  return {
    schemaVersion: 1,
    id: mapScope.appMapId,
    organizationId: mapScope.organizationId,
    projectId: mapScope.projectId,
    name: "Store",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: mapScreen("home", "Home"),
      checkout: mapScreen("checkout", "Checkout"),
      languages: mapScreen("languages", "App Language"),
    },
    screenVariants: {},
    connections: { [checkout.id]: checkout, [languages.id]: languages },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {
      purchase: {
        ...mapEntity("purchase"),
        name: "Purchase",
        startScreenId: "home",
        connectionIds: [checkout.id],
      },
      picker: {
        ...mapEntity("picker"),
        name: "Open languages",
        startScreenId: "home",
        connectionIds: [languages.id],
      },
    },
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: mapAt,
    updatedAt: mapAt,
  };
}

test("recorded locale prelude prefers the language-list path over the product flow", () => {
  const map = storeMap();
  const prelude = recordedLocalePreludeFromMap(map, { bodyFlowId: "purchase" });
  assert.equal(prelude?.sourceConnectionId, "open-languages");
  assert.deepEqual(
    prelude?.entryPath.map((step) =>
      step.kind === "tap" ? (step.target.label ?? step.target.text) : step.kind,
    ),
    ["Profile", "wait", "Language"],
  );
  assert.equal(localeLoopBodyFlowId(map, prelude?.sourceConnectionId), "purchase");
  const taught = applyRecordedLocalePrelude(
    localeRunScopeFromTeach({
      nodes: pickerNodes,
      examples: [{ locale: "en", identifier: "lang.en" }],
      screenshotEachLocale: true,
      restoreAtEnd: false,
      entryPath: prelude?.entryPath,
    }),
    prelude,
  );
  assert.ok(!JSON.stringify(taught.entryPath).includes("sidebar.settings.button"));
  assert.ok(
    taught.entryPath?.some((step) => step.kind === "tap" && step.target.label === "Profile"),
  );
  const { root } = composeLocaleRunRecipes({
    body,
    scope: taught,
    batchId: "recorded-prelude",
  });
  const preludeTaps = root.steps
    .filter((step) => step.kind === "tap")
    .map((step) =>
      "target" in step
        ? (step.target.identifier ?? step.target.label ?? step.target.text ?? "")
        : "",
    );
  assert.ok(preludeTaps.includes("Profile"));
  assert.ok(preludeTaps.includes("Language"));
  assert.ok(!preludeTaps.some((target) => /sidebar\.settings|app language/i.test(target)));
});

test("without a recorded picker path there is no invented prelude", () => {
  const map = storeMap();
  delete map.connections["open-languages"];
  delete map.flows.picker;
  assert.equal(recordedLocalePreludeFromMap(map, { bodyFlowId: "purchase" }), undefined);
});

test("inferLocaleOptionsFromTeach expands 1–2 taught rows across the a11y picker", () => {
  const inferred = inferLocaleOptionsFromTeach({
    nodes: pickerNodes,
    examples: [
      { locale: "en", identifier: "lang.en" },
      { locale: "pt-BR", label: "Português (Brasil)" },
    ],
  });
  assert.deepEqual(inferred.locales, ["en", "pt-BR", "it"]);
  assert.deepEqual(inferred.languageOptions.en, { identifier: "lang.en" });
  assert.deepEqual(inferred.languageOptions["pt-BR"], { identifier: "lang.pt-BR" });
  assert.deepEqual(inferred.languageOptions.it, { label: "Italiano" });
});

test("localeRunScopeFromTeach honors screenshot-each-locale and zips inferred identifiers", async () => {
  const scope = localeRunScopeFromTeach({
    nodes: pickerNodes,
    examples: [{ locale: "en", identifier: "lang.en" }],
    locales: ["en", "it"],
    screenshotEachLocale: true,
    restoreAtEnd: false,
    languagePath: [{ kind: "tap", target: { text: "App Language" } }],
  });
  assert.equal(scope.screenshotEachLocale, true);
  assert.deepEqual(scope.locales, ["en", "it"]);
  assert.deepEqual(scope.languageOptions?.en, { identifier: "lang.en" });
  assert.deepEqual(scope.languageOptions?.it, { label: "Italiano" });
  assert.ok(scope.languagePath?.length);
  const prepared = await prepareLocaleRunMatrix(scope, 7);
  assert.equal(prepared.matrix.cases.length, 2);
  assert.equal(prepared.matrix.cases[0]!.values.locale_identifier, "lang.en");
  assert.equal(prepared.matrix.cases[1]!.values.locale_label, "Italiano");
  const { root } = composeLocaleRunRecipes({
    body,
    scope,
    batchId: "teach-1",
  });
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "screenshot").map((step) => step.caption),
    ["locale:{{locale}} before body", "locale:{{locale}} after body"],
  );
});

test("startLocaleRecipeRun freezes screenshot-each-locale steps and export copies stub frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-locale-run-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
    state: process.env.RELAY_STATE_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = directory;
  process.env.RELAY_RECIPES_DIR = join(directory, "recipes");
  process.env.RELAY_TESTS_DIR = join(directory, "tests");
  process.env.RELAY_STATE_DIR = join(directory, "state");
  try {
    const recipe = await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:test",
        actorKind: "human",
        organizationId: "local",
        projectId: "default",
        operationId: "recipe.create",
        requestId: "locale-run-test",
        idempotencyKey: "locale-run-test",
        issuedAt: Date.now(),
      },
      () =>
        saveRecipe({
          id: body.id,
          title: body.title,
          steps: body.steps,
          expectedRevision: 0,
        }),
    );
    const scope = localeRunScopeFromTeach({
      nodes: pickerNodes,
      examples: [{ locale: "en", identifier: "lang.en" }],
      locales: ["en", "it"],
      languagePath: [{ kind: "tap", target: { text: "App Language" } }],
      screenshotEachLocale: true,
      restoreAtEnd: false,
    });
    const batch = await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:test",
        actorKind: "human",
        organizationId: "local",
        projectId: "default",
        operationId: "job.locale-matrix.start",
        requestId: "locale-run-start",
        idempotencyKey: "locale-run-start",
        issuedAt: Date.now(),
      },
      () =>
        startLocaleRecipeRun({
          recipeId: recipe.id,
          targetId: "stub-serial",
          platform: "ios",
          scope,
        }),
    );
    for (const job of batch.jobs) cancelJob(job.id);
    assert.equal(batch.jobs.length, 2);
    const captions = batch.jobs[0]!.recipeSnapshot?.steps.filter(
      (step) => step.kind === "screenshot",
    ).map((step) => ("caption" in step ? step.caption : undefined));
    assert.deepEqual(captions, ["locale:{{locale}} before body", "locale:{{locale}} after body"]);
    assert.equal(
      batch.jobs[0]!.resolvedInputs?.locale ?? batch.matrix.cases[0]!.values.locale,
      "en",
    );

    for (const job of batch.jobs) {
      const locale = String(job.resolvedInputs?.locale ?? job.title ?? job.id);
      job.runDir = join(directory, "runs", job.id);
      await mkdir(join(job.runDir, "frames"), { recursive: true });
      await writeFile(join(job.runDir, "frames", "001-screen.png"), locale);
    }
    const pack = await exportLocaleRunPack({
      batchId: batch.id,
      jobs: batch.jobs,
      recipeId: recipe.id,
      title: batch.title,
    });
    assert.equal(pack.manifest.cases.length, 2);
    assert.ok(pack.manifest.cases.every((item) => item.frames.length === 1));
    assert.ok(pack.manifest.locales.includes("en"));
    assert.ok(pack.manifest.locales.includes("it"));
  } finally {
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    await rm(directory, { recursive: true, force: true });
  }
});

test("startLocaleRecipeRun accepts a compiled App Map body without a recipe store row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-locale-compiled-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
    state: process.env.RELAY_STATE_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = directory;
  process.env.RELAY_RECIPES_DIR = join(directory, "recipes");
  process.env.RELAY_TESTS_DIR = join(directory, "tests");
  process.env.RELAY_STATE_DIR = join(directory, "state");
  try {
    const compiled: Recipe = {
      id: "app-map:map-1:flow:checkout:r1",
      title: "Checkout · locales body",
      source: "custom",
      steps: [{ kind: "screenshot", caption: "checkout" }],
      createdAt: 1,
      updatedAt: 1,
    };
    const batch = await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:test",
        actorKind: "human",
        organizationId: "local",
        projectId: "default",
        operationId: "job.locale-matrix.start",
        requestId: "locale-compiled-start",
        idempotencyKey: "locale-compiled-start",
        issuedAt: Date.now(),
      },
      () =>
        startLocaleRecipeRun({
          recipeId: compiled.id,
          compiledBody: compiled,
          compiledGraph: { [compiled.id]: compiled },
          targetId: "stub-serial",
          platform: "ios",
          scope: {
            locales: ["en"],
            languagePath: [{ kind: "tap", target: { text: "App Language" } }],
            screenshotEachLocale: true,
            restoreAtEnd: false,
          },
        }),
    );
    for (const job of batch.jobs) cancelJob(job.id);
    assert.equal(batch.jobs.length, 1);
    assert.equal(batch.bodyRecipeId, compiled.id);
    assert.ok(
      batch.jobs[0]!.recipeSnapshot?.steps.some(
        (step) => step.kind === "screenshot" && step.caption === "locale:{{locale}} before body",
      ),
    );
  } finally {
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    await rm(directory, { recursive: true, force: true });
  }
});
