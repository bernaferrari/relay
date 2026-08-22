import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapCombine, AppMapScenarioTest } from "@relay/protocol";
import { appMapCombineCellId } from "./app-map-combine-cell.js";
import {
  AppMapCombineCellContractError,
  prepareAppMapCombineCells,
} from "./app-map-combine-cell-prepare.js";
import {
  AppMapCombineWorldError,
  compatibleDefaultTargetProfileId,
  resolveCombineCellSelector,
  upsertAppMapCombineFromTest,
  variableCanApply,
} from "./app-map-combine-from-test.js";

function scope(id: string) {
  return { organizationId: "org", projectId: "project", appMapId: "settings", id };
}

function scriptTest(): AppMapScenarioTest {
  return {
    ...scope("script-only"),
    name: "Prepare once",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "prepare",
        kind: "script",
        intent: "Prepare without a selector",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function localeMap(): AppMap {
  const work = scriptTest();
  const combine: AppMapCombine = {
    ...scope("locales"),
    name: "Language × Prepare",
    variableIds: ["language"],
    testIds: [work.id],
    selected: { language: ["en", "it"] },
    cellRuntimeProfiles: [
      { testId: work.id, values: { language: "en" }, targetProfileId: "pixel-en" },
      { testId: work.id, values: { language: "it" }, targetProfileId: "pixel-it" },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    schemaVersion: 1,
    id: "settings",
    organizationId: "org",
    projectId: "project",
    name: "Settings",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: {
        ...scope("home"),
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: ["home-en", "home-it"],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {
      "home-en": {
        ...scope("home-en"),
        screenId: "home",
        targetProfile: {
          id: "pixel-en",
          targetId: "pixel-1",
          source: "device",
          platform: "android",
          name: "Pixel · English",
          capabilities: ["snapshot"],
          observedAt: 1,
        },
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [],
        evidenceUris: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "home-it": {
        ...scope("home-it"),
        screenId: "home",
        targetProfile: {
          id: "pixel-it",
          targetId: "pixel-1",
          source: "device",
          platform: "android",
          name: "Pixel · Italian",
          capabilities: ["snapshot"],
          observedAt: 1,
        },
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [],
        evidenceUris: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    connections: {},
    caseStacks: {},
    variables: {
      language: {
        ...scope("language"),
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [
          { id: "en", label: "English" },
          { id: "it", label: "Italiano" },
          { id: "ja", label: "日本語" },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    tests: { [work.id]: work },
    combines: { [combine.id]: combine },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

test("a Variable can apply when it has In+Out, appLocale, or a toggle", () => {
  assert.equal(
    variableCanApply({
      apply: { kind: "appLocale", app: "com.example" },
      options: [{ id: "en" }],
    }),
    true,
  );
  assert.equal(
    variableCanApply({
      apply: {
        kind: "list",
        entryPath: [{ kind: "tap", target: { label: "Open" } }],
        exitPath: [{ kind: "back" }],
      },
      options: [{ id: "en" }],
    }),
    true,
  );
  assert.equal(
    variableCanApply({
      apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
      options: [{ id: "en" }],
    }),
    false,
  );
  assert.equal(
    variableCanApply({
      apply: {
        kind: "toggle",
        target: { identifier: "appearance" },
        on: { label: "On" },
        off: { label: "Off" },
      },
      options: [],
    }),
    true,
  );
});

test("upsert Combine from a Test revises the deterministic Combine instead of duplicating", () => {
  const map = localeMap();
  const first = upsertAppMapCombineFromTest({
    map,
    testId: "script-only",
    selected: { language: ["ja", "it"] },
    lens: "visual",
    now: 10,
  });
  assert.equal(first.created, true);
  assert.equal(first.combine.id, "matrix-language-to-script-only");
  assert.deepEqual(first.combine.selected, { language: ["ja", "it"] });
  assert.deepEqual(first.combine.captures, { "script-only": { mode: "every-screen" } });
  map.combines[first.combine.id] = first.combine;
  const revised = upsertAppMapCombineFromTest({
    map,
    testId: "script-only",
    selected: { language: ["ja"] },
    lens: "smoke",
    now: 20,
  });
  assert.equal(revised.created, false);
  assert.equal(revised.combine.id, first.combine.id);
  assert.equal(revised.combine.createdAt, 10);
  assert.equal(revised.combine.updatedAt, 20);
  assert.deepEqual(revised.combine.selected, { language: ["ja"] });
  assert.deepEqual(revised.combine.captures, { "script-only": { mode: "failures-only" } });
});

test("upsert Combine rejects unknown Variable or value ids", () => {
  const map = localeMap();
  assert.throws(
    () =>
      upsertAppMapCombineFromTest({
        map,
        testId: "script-only",
        selected: { theme: ["dark"] },
      }),
    (error: unknown) =>
      error instanceof AppMapCombineWorldError && error.code === "unknown-variable",
  );
  assert.throws(
    () =>
      upsertAppMapCombineFromTest({
        map,
        testId: "script-only",
        selected: { language: ["xx"] },
      }),
    (error: unknown) => error instanceof AppMapCombineWorldError && error.code === "unknown-value",
  );
});

test("a default target fills missing cell profile bindings from compatible saved profiles", async () => {
  const map = localeMap();
  map.combines.locales!.cellRuntimeProfiles = [];
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: map.combines.locales!,
    target: { targetId: "pixel-1", platform: "android" },
  });
  assert.deepEqual(
    prepared.cells.map((cell) => [cell.values.language, cell.targetProfileId]),
    [
      ["en", "pixel-en"],
      ["it", "pixel-it"],
    ],
  );
});

test("missing cell bindings still fail when no default target is supplied", async () => {
  const map = localeMap();
  map.combines.locales!.cellRuntimeProfiles = [
    { testId: "script-only", values: { language: "en" }, targetProfileId: "pixel-en" },
  ];
  await assert.rejects(
    () =>
      prepareAppMapCombineCells({
        map,
        combine: map.combines.locales!,
      }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.issues.some((item) => item.code === "missing-binding"),
  );
});

test("equally ranked same-target profiles stay unbound even with a default target", async () => {
  const profiles = [
    { id: "pixel-en", name: "Pixel · English", targetId: "pixel-1", platform: "android" },
    { id: "pixel-english", name: "Pixel · English", targetId: "pixel-1", platform: "android" },
  ];
  assert.equal(
    compatibleDefaultTargetProfileId({
      profiles,
      target: { targetId: "pixel-1", platform: "android" },
      values: { language: "en" },
    }),
    undefined,
  );
  const map = localeMap();
  map.screenVariants["home-en"]!.targetProfile = {
    ...map.screenVariants["home-en"]!.targetProfile,
    id: "pixel-en",
    name: "Pixel · English",
  };
  map.screenVariants["home-it"]!.targetProfile = {
    ...map.screenVariants["home-it"]!.targetProfile,
    id: "pixel-english",
    name: "Pixel · English",
    targetId: "pixel-1",
    platform: "android",
  };
  map.combines.locales!.cellRuntimeProfiles = [];
  map.combines.locales!.selected = { language: ["en"] };
  await assert.rejects(
    () =>
      prepareAppMapCombineCells({
        map,
        combine: map.combines.locales!,
        target: { targetId: "pixel-1", platform: "android" },
      }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.issues.some((item) => item.code === "missing-binding"),
  );
});

test("compatible profile ranking prefers the same device and matching value tokens", () => {
  const profiles = [
    { id: "pixel-en", name: "Pixel · English", targetId: "pixel-1", platform: "android" },
    { id: "pixel-it", name: "Pixel · Italian", targetId: "pixel-1", platform: "android" },
    { id: "ipad-it", name: "iPad · Italian", targetId: "ipad-1", platform: "ios" },
  ];
  assert.equal(
    compatibleDefaultTargetProfileId({
      profiles,
      target: { targetId: "pixel-1", platform: "android" },
      values: { language: "it" },
    }),
    "pixel-it",
  );
  assert.equal(
    compatibleDefaultTargetProfileId({
      profiles,
      target: { targetId: "pixel-1", platform: "android" },
      values: { language: "it" },
      explicitProfileId: "pixel-en",
    }),
    "pixel-en",
  );
});

test("a cell selector picks one world without firing the rest", () => {
  const cells = [
    {
      cellId: appMapCombineCellId("script-only", { language: "en" }),
      testId: "script-only",
      values: { language: "en" },
      worldLabel: "English",
    },
    {
      cellId: appMapCombineCellId("script-only", { language: "it" }),
      testId: "script-only",
      values: { language: "it" },
      worldLabel: "Italiano",
    },
  ];
  assert.deepEqual(resolveCombineCellSelector(cells, "it"), [cells[1]!.cellId]);
  assert.deepEqual(resolveCombineCellSelector(cells, cells[0]!.cellId), [cells[0]!.cellId]);
  assert.throws(
    () => resolveCombineCellSelector(cells, "fr"),
    (error: unknown) => error instanceof AppMapCombineWorldError && error.code === "unknown-value",
  );
});
