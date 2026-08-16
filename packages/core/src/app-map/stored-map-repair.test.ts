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

test("quarantines a structurally broken App Map instead of throwing", () => {
  const loaded = loadStoredAppMap({ schemaVersion: 1 }, "p:broken");
  assert.equal(loaded.ok, false);
  if (loaded.ok) return;
  assert.match(loaded.error, /App Map/);
  assert.deepEqual(loaded.raw, { schemaVersion: 1 });
});
