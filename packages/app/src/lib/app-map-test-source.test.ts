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
