import assert from "node:assert/strict";
import test from "node:test";
import { deleteUnknownFieldAtLabel, loadStoredAppMap } from "./stored-map-repair.js";
import { APP_MAP_SCHEMA_VERSION } from "./model.js";

test("strips an unknown field at an App Map validation label", () => {
  const document = {
    tests: {
      smoke: {
        steps: [{ id: "launch", kind: "instruction", cleanup: { kind: "home" }, intent: "Launch" }],
      },
    },
  };
  assert.equal(
    deleteUnknownFieldAtLabel(document, "App Map.tests.smoke.steps[0]", "cleanup"),
    true,
  );
  assert.equal("cleanup" in document.tests.smoke.steps[0]!, false);
});

test("repairs a persisted App Map that still carries a removed step field", () => {
  const candidate = {
    schemaVersion: APP_MAP_SCHEMA_VERSION,
    id: "store",
    organizationId: "acme",
    projectId: "mobile",
    name: "Store",
    revision: 0,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {
      smoke: {
        id: "smoke",
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "store",
        name: "Smoke",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "launch",
            kind: "instruction",
            intent: "Launch home",
            cleanup: { kind: "home" },
            binding: { status: "unresolved", reason: "not mapped yet" },
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
  const loaded = loadStoredAppMap(candidate, "mobile:store");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.repaired, true);
  assert.equal("cleanup" in loaded.appMap.tests.smoke!.steps[0]!, false);
});

test("migrates a structurally valid unversioned App Map without mutating its source", () => {
  const legacy = {
    id: "store",
    organizationId: "acme",
    projectId: "mobile",
    name: "Store",
    revision: 0,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
  const loaded = loadStoredAppMap(legacy, "mobile:store");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.disposition, "migrated");
  assert.equal(loaded.appMap.schemaVersion, APP_MAP_SCHEMA_VERSION);
  assert.equal("schemaVersion" in legacy, false);
  assert.deepEqual(loaded.original, legacy);
});

test("accepts a current App Map without marking it migrated", () => {
  const current = {
    schemaVersion: APP_MAP_SCHEMA_VERSION,
    id: "store",
    organizationId: "acme",
    projectId: "mobile",
    name: "Store",
    revision: 0,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
  const loaded = loadStoredAppMap(current, "mobile:store");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.migrated, false);
  assert.equal(loaded.disposition, "ready");
});

test("keeps newer App Maps read-only and preserves their complete source", () => {
  const future = { schemaVersion: APP_MAP_SCHEMA_VERSION + 1, id: "store", novelField: true };
  const loaded = loadStoredAppMap(future, "mobile:store");
  assert.equal(loaded.ok, false);
  if (loaded.ok) return;
  assert.equal(loaded.disposition, "read-only");
  assert.match(loaded.error, /newer schemaVersion/u);
  assert.deepEqual(loaded.raw, future);
});

test("does not guess-convert an explicitly unknown historical schema", () => {
  const unknownHistorical = { schemaVersion: 0, id: "store" };
  const loaded = loadStoredAppMap(unknownHistorical, "mobile:store");
  assert.equal(loaded.ok, false);
  if (loaded.ok) return;
  assert.equal(loaded.disposition, "quarantined");
  assert.match(loaded.error, /unsupported historical schemaVersion 0/u);
  assert.deepEqual(loaded.raw, unknownHistorical);
});

test("quarantines a structurally broken App Map instead of throwing", () => {
  const loaded = loadStoredAppMap({ schemaVersion: 1 }, "p:broken");
  assert.equal(loaded.ok, false);
  if (loaded.ok) return;
  assert.match(loaded.error, /App Map/);
  assert.equal(loaded.disposition, "quarantined");
  assert.deepEqual(loaded.raw, { schemaVersion: 1 });
});
