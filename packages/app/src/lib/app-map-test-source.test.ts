import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { applyAppMapTestSource, projectAppMapTestSource } from "./app-map-test-source";

function fixture(): { map: AppMap; scenario: AppMapScenarioTest } {
  const scenario: AppMapScenarioTest = {
    id: "settings-test",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: "Settings path",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open-settings",
        kind: "instruction",
        intent: "Open Settings",
        capture: true,
        binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map = {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "secret selector evidence",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      home: {
        id: "home",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "home" },
        variantIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      settings: {
        id: "settings",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Settings",
        identity: { schemaVersion: 1, fingerprint: "settings" },
        variantIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {},
    connections: {
      open: {
        id: "open",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        fromScreenId: "home",
        destination: { kind: "screen" as const, screenId: "settings" },
        state: "ready" as const,
        actions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    caseStacks: {},
    variables: {},
    tests: { [scenario.id]: scenario },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  } as AppMap;
  return { map, scenario };
}

test("thin source shows readable path and checkpoint without selectors or evidence", () => {
  const { map, scenario } = fixture();
  const projection = projectAppMapTestSource(map, scenario);
  assert.equal(projection.kind, "ready");
  if (projection.kind !== "ready") return;
  assert.match(projection.source, /intent: Open Settings/u);
  assert.match(projection.source, /path:\n\s+- open/u);
  assert.match(projection.source, /checkpoint: settings/u);
  assert.doesNotMatch(projection.source, /secret selector evidence|screenVariants/u);

  const edited = applyAppMapTestSource({
    map,
    current: scenario,
    source: projection.source.replace("Open Settings", "Open app settings"),
    updatedAt: 2,
  });
  assert.equal(edited.ok, true);
  if (edited.ok) assert.equal(edited.test.steps[0]?.intent, "Open app settings");
});

test("invalid and unsupported source never produce a Test to save", () => {
  const { map, scenario } = fixture();
  assert.deepEqual(applyAppMapTestSource({ map, current: scenario, source: "steps: [" }).ok, false);
  const advanced: AppMapScenarioTest = {
    ...scenario,
    steps: [
      {
        id: "decision",
        kind: "decision",
        intent: "Choose a branch",
        binding: {
          status: "resolved",
          kind: "condition",
          input: "account",
          operator: "exists",
        },
        thenSteps: [],
      },
    ],
  };
  const projection = projectAppMapTestSource(map, advanced);
  assert.equal(projection.kind, "unsupported");
  if (projection.kind === "unsupported") assert.match(projection.message, /advanced Test editor/u);
});

test("Repeat YAML round-trips through the Test-owned canonical Combine", () => {
  const { map, scenario } = fixture();
  map.variables.language = {
    id: "language",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: "Language",
    kind: "language",
    apply: { kind: "appLocale", app: "com.example" },
    options: [
      { id: "en", label: "English" },
      { id: "pt-BR", label: "Portuguese (Brazil)" },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = projectAppMapTestSource(map, scenario);
  assert.equal(initial.kind, "ready");
  if (initial.kind !== "ready") return;
  const source = `${initial.source}repeat:\n  dimensions:\n    - variable: language\n      values: all\n`;
  const applied = applyAppMapTestSource({
    map,
    current: scenario,
    source,
    updatedAt: 2,
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.repeatChanges.length, 1);
  const save = applied.repeatChanges[0];
  assert.equal(save?.kind, "combine.save");
  if (save?.kind !== "combine.save") return;
  assert.deepEqual(save.combine.variableIds, ["language"]);
  assert.equal(save.combine.strategy, undefined);
  assert.equal(save.combine.selected, undefined);

  map.combines[save.combine.id] = save.combine;
  const projected = projectAppMapTestSource(map, applied.test);
  assert.equal(projected.kind, "ready");
  if (projected.kind !== "ready") return;
  assert.match(projected.source, /repeat:\n\s+dimensions:/u);
  assert.match(projected.source, /variable: language\n\s+values: all/u);

  const removed = applyAppMapTestSource({
    map,
    current: applied.test,
    source: projected.source.replace(/repeat:[\s\S]*$/u, ""),
    updatedAt: 3,
  });
  assert.equal(removed.ok, true);
  if (removed.ok) {
    assert.deepEqual(removed.repeatChanges, [
      { kind: "combine.remove", combineId: save.combine.id },
    ]);
  }
});

test("Source fails closed when one Test has multiple canonical Repeat definitions", () => {
  const { map, scenario } = fixture();
  map.combines.first = {
    id: "first",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: "First",
    variableIds: ["language"],
    testIds: [scenario.id],
    createdAt: 1,
    updatedAt: 1,
  };
  map.combines.second = { ...map.combines.first, id: "second", name: "Second" };
  const projection = projectAppMapTestSource(map, scenario);
  assert.equal(projection.kind, "unsupported");
  if (projection.kind === "unsupported") assert.match(projection.message, /multiple saved Repeat/u);
});
