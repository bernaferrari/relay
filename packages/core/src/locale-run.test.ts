import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyRecordedLocalePrelude,
  composeLocaleRunRecipes,
  defaultGrokLocaleScope,
  inferLocaleOptionsFromTeach,
  localeLoopBodyFlowId,
  localeNavFromRecipeSteps,
  localeRunScopeFromTeach,
  completeTaughtLocaleScope,
  prepareLocaleRunMatrix,
  prepareLocaleRecipeRun,
  recordedLocalePreludeFromMap,
  stagePreparedLocaleRecipeRun,
  startLocaleRecipeRun,
  type LocaleRunScope,
} from "./locale-run.js";
import { artifactLocale, evidenceFrameNames, exportLocaleRunPack } from "./locale-run-pack.js";
import type { SnapshotNode } from "./device.js";
import type { Recipe } from "./recipes.js";
import type { AppMap, AppMapEntity, Connection, Screen } from "@relay/protocol";
import { saveRecipe } from "./recipes.js";
import { cancelJob, waitForJobCompletion, type TestJob } from "./session.js";
import { runWithOperationContext } from "./operation-context.js";

/** Cancelling only requests a stop. The scheduled execution still writes its
 * terminal run into the workspace, so a test that removes its temp directory
 * before that drains races the write and fails with ENOTEMPTY. */
async function cancelAndDrain(jobs: readonly TestJob[]): Promise<void> {
  for (const job of jobs) cancelJob(job.id);
  await Promise.all(jobs.map((job) => waitForJobCompletion(job.id)));
}

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

test("the frames the matrix wraps a body in are not the screen under test", () => {
  // composeLocaleRunRecipes brackets the body with its own screenshots so a
  // reviewer can see the language change land. "before body" is whatever surface
  // the switch finished on — Apple's Settings on an iOS sweep — and "after body"
  // is the authored screen again. Reading them as content compares the harness
  // against itself and reports every real finding twice.
  const job = {
    id: "wrapped",
    artifacts: [{ kind: "frozen-inputs", capturedAt: 1, data: { expectedScreenshots: 1 } }],
    steps: [
      {
        frames: [
          {
            path: "frames/001.png",
            caption: "before · Tap identifier PREFERRED_LANGUAGE",
            capturedAt: 1,
          },
          { path: "frames/002.png", caption: "locale:pt-BR before body", capturedAt: 2 },
          { path: "frames/003.png", caption: "ask-screen", capturedAt: 3 },
          { path: "frames/004.png", caption: "locale:pt-BR after body", capturedAt: 4 },
          { path: "frames/005.png", caption: "world before body", capturedAt: 5 },
        ],
      },
    ],
  } as unknown as TestJob;

  assert.deepEqual([...evidenceFrameNames(job).names!], ["003.png"]);
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

test("Android appLocale scopes need no picker path and set locale before the Test body", async () => {
  const scope: LocaleRunScope = {
    locales: ["en", "it"],
    app: "com.example.app",
    appLocale: "com.example.app",
    restoreAtEnd: false,
    screenshotEachLocale: false,
  };
  const { root } = composeLocaleRunRecipes({ body, scope, batchId: "app-locale" });
  assert.deepEqual(root.steps.slice(0, 3), [
    { kind: "app", action: "set-locale", app: "com.example.app", locale: "{{locale}}" },
    { kind: "app", action: "open", app: "com.example.app", relaunch: true },
    { kind: "sleep", ms: 1200 },
  ]);
  assert.equal(
    root.steps.some((step) => step.kind === "branch"),
    false,
  );
  await assert.doesNotReject(() =>
    prepareLocaleRecipeRun({ recipeId: body.id, compiledBody: body, scope }),
  );
});

test("Android appLocale stays when a module-rooted Test names a destination", () => {
  const leaf: Recipe = {
    ...body,
    id: "data-controls-leaf",
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
  const compiled: Recipe = {
    ...body,
    id: "data-controls-test",
    steps: [{ kind: "module", recipeId: leaf.id }],
  };
  const { root } = composeLocaleRunRecipes({
    body: compiled,
    bodyGraph: { [compiled.id]: compiled, [leaf.id]: leaf },
    scope: {
      locales: ["he"],
      app: "com.example.app",
      appLocale: "com.example.app",
      restoreAtEnd: false,
      screenshotEachLocale: false,
    },
    batchId: "app-locale-stay-default",
  });
  assert.equal(
    root.steps.some((step) => step.kind === "app" && step.action === "open"),
    false,
  );
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

test("Android appLocale relaunches when apply.relaunch is explicit true", () => {
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
  const { root } = composeLocaleRunRecipes({
    body: destination,
    scope: {
      locales: ["he"],
      app: "com.example.app",
      appLocale: "com.example.app",
      relaunch: true,
      restoreAtEnd: false,
      screenshotEachLocale: false,
    },
    batchId: "app-locale-relaunch-explicit",
  });
  assert.ok(
    root.steps.some(
      (step) => step.kind === "app" && step.action === "open" && step.relaunch === true,
    ),
  );
  assert.equal(
    root.steps.some((step) => step.kind === "expect-screen"),
    false,
  );
});

test("Android appLocale stay is explicit and skips the default relaunch", () => {
  const { root } = composeLocaleRunRecipes({
    body,
    scope: {
      locales: ["he"],
      app: "com.example.app",
      appLocale: "com.example.app",
      relaunch: false,
      restoreAtEnd: false,
      screenshotEachLocale: false,
    },
    batchId: "app-locale-stay",
  });
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "app"),
    [{ kind: "app", action: "set-locale", app: "com.example.app", locale: "{{locale}}" }],
  );
});

test("Android appLocale stay re-proves destination through a module-rooted Test", () => {
  const leaf: Recipe = {
    ...body,
    id: "data-controls-leaf",
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
  const compiled: Recipe = {
    ...body,
    id: "data-controls-test",
    steps: [{ kind: "module", recipeId: leaf.id }],
  };
  const { root } = composeLocaleRunRecipes({
    body: compiled,
    bodyGraph: { [compiled.id]: compiled, [leaf.id]: leaf },
    scope: {
      locales: ["he"],
      app: "com.example.app",
      appLocale: "com.example.app",
      relaunch: false,
      restoreAtEnd: false,
      screenshotEachLocale: false,
    },
    batchId: "app-locale-stay-module",
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

test("prepareLocaleRecipeRun stay follows the frozen child graph", async () => {
  const leaf: Recipe = {
    ...body,
    id: "data-controls-leaf",
    steps: [
      {
        kind: "expect-screen",
        id: "data-controls",
        screenId: "data-controls",
        screenTitle: "Data Controls",
        fingerprint: "a".repeat(64),
      },
    ],
  };
  const compiled: Recipe = {
    ...body,
    id: "data-controls-test",
    steps: [{ kind: "module", recipeId: leaf.id }],
  };
  const prepared = await prepareLocaleRecipeRun({
    recipeId: compiled.id,
    compiledBody: compiled,
    compiledGraph: { [compiled.id]: compiled, [leaf.id]: leaf },
    scope: {
      locales: ["he"],
      app: "com.example.app",
      appLocale: "com.example.app",
      relaunch: false,
      restoreAtEnd: false,
      screenshotEachLocale: false,
    },
  });
  assert.ok(
    prepared.recipeSnapshot.steps.some(
      (step) => step.kind === "expect-screen" && step.id === "data-controls-stay",
    ),
  );
});

test("Android appLocale stay re-proves the Test destination when it has identity", () => {
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
  const { root } = composeLocaleRunRecipes({
    body: destination,
    scope: {
      locales: ["he"],
      app: "com.example.app",
      appLocale: "com.example.app",
      relaunch: false,
      restoreAtEnd: false,
      screenshotEachLocale: false,
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

test("prepareLocaleRunMatrix keeps all dynamically discovered locale options", async () => {
  const locales = Array.from({ length: 45 }, (_, index) => `x-relay-${index + 1}`);
  const prepared = await prepareLocaleRunMatrix({ locales, restoreAtEnd: false }, 42);
  assert.equal(prepared.matrix.cases.length, 45);
  assert.deepEqual(prepared.locales, locales);
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
    await cancelAndDrain(batch.jobs);
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
    assert.ok(
      pack.manifest.cases.every((item) => item.frames.length === 1),
      JSON.stringify(pack.manifest.cases, null, 2),
    );
    assert.ok(pack.manifest.locales.includes("en"));
    assert.ok(pack.manifest.locales.includes("it"));
    // Stub frames carry no tree, so both locales are present and unreadable.
    assert.deepEqual(pack.manifest.analysis.findings, []);
    assert.deepEqual(pack.manifest.analysisCoverage, { frames: 2, inspectedFrames: 0 });
    assert.deepEqual(Object.keys(pack.manifest.byCanonicalKey["frame-001"] ?? {}).sort(), [
      "en",
      "it",
    ]);
    const report = await readFile(join(pack.rootDir, "index.html"), "utf8");
    assert.match(report, /of 2 runs passed/);
    assert.match(report, /001-screen\.png/);
    assert.match(report, /2 frames without a UI tree/);
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
    await cancelAndDrain(batch.jobs);
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

test("prepared locale runs require exact per-case local bindings and preserve them in staged evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-locale-stage-"));
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
    const prepared = await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:test",
        actorKind: "human",
        organizationId: "local",
        projectId: "default",
        operationId: "job.locale-matrix.start",
        requestId: "locale-stage-prepare",
        idempotencyKey: "locale-stage-prepare",
        issuedAt: Date.now(),
      },
      () =>
        prepareLocaleRecipeRun({
          recipeId: body.id,
          compiledBody: body,
          compiledGraph: { [body.id]: body },
          scope: {
            locales: ["en", "it"],
            languagePath: [{ kind: "tap", target: { text: "App Language" } }],
            restoreAtEnd: false,
          },
        }),
    );
    assert.throws(
      () =>
        stagePreparedLocaleRecipeRun({
          prepared,
          targetBindings: [],
        }),
      /cover every case/,
    );
    const target = (targetId: string) =>
      ({
        schemaVersion: 1 as const,
        kind: "local-device" as const,
        provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
        targetId,
        platform: "android" as const,
        identity: { kind: "device-serial" as const, value: targetId },
      }) as const;
    const staged = await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:test",
        actorKind: "human",
        organizationId: "local",
        projectId: "default",
        operationId: "job.locale-matrix.start",
        requestId: "locale-stage-jobs",
        idempotencyKey: "locale-stage-jobs",
        issuedAt: Date.now(),
      },
      () =>
        stagePreparedLocaleRecipeRun({
          prepared,
          targetBindings: prepared.cases.map((item) => ({
            caseIndex: item.caseIndex,
            locale: item.locale,
            executionTarget: target(`pixel-${item.caseIndex + 1}`),
          })),
        }),
    );
    try {
      assert.deepEqual(
        staged.jobs.map((job) => job.executionTarget?.targetId),
        ["pixel-1", "pixel-2"],
      );
      const frozen = staged.jobs[1]!.artifacts.find(
        (artifact) => artifact.kind === "frozen-inputs",
      );
      assert.ok(frozen, "staged locale job retains frozen inputs");
      const frozenData = frozen.data as {
        executionTarget?: unknown;
        targetBinding?: unknown;
      };
      assert.deepEqual(frozenData.executionTarget, target("pixel-2"));
      assert.deepEqual(frozenData.targetBinding, {
        schemaVersion: 1,
        caseIndex: 1,
        locale: "it",
      });
    } finally {
      staged.rollback();
    }
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
