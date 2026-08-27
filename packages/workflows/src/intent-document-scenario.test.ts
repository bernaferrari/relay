import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import {
  applyIntentDocumentToScenarioTest,
  intentDocumentFromScenarioTest,
} from "./intent-document-scenario.js";
import { formatIntentDocumentYaml, parseIntentDocumentYaml } from "./intent-document.js";

function fixture(): { map: AppMap; test: AppMapScenarioTest } {
  const scope = { organizationId: "acme", projectId: "mobile", appMapId: "settings" };
  const map: AppMap = {
    schemaVersion: 1,
    id: "settings",
    organizationId: "acme",
    projectId: "mobile",
    name: "Settings",
    revision: 7,
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
  map.connections.open = {
    ...scope,
    id: "open",
    label: "Open Settings",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "settings" },
    state: "ready",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const scenario: AppMapScenarioTest = {
    ...scope,
    id: "settings-check",
    name: "Settings check",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "instruction",
        id: "open-settings",
        intent: "Open Settings",
        capture: true,
        binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  map.tests[scenario.id] = scenario;
  return { map, test: scenario };
}

test("golden path and checkpoint round-trip through thin YAML", () => {
  const { map, test: scenario } = fixture();
  const source = formatIntentDocumentYaml(intentDocumentFromScenarioTest(map, scenario));
  assert.match(source, /path:\n\s+- open\n\s+checkpoint: settings/u);
  const applied = applyIntentDocumentToScenarioTest({
    map,
    current: scenario,
    document: parseIntentDocumentYaml(source.replace("Open Settings", "Open app settings")),
  });
  assert.equal(applied.steps[0]?.intent, "Open app settings");
  assert.deepEqual(applied.steps[0], {
    kind: "instruction",
    id: "open-settings",
    intent: "Open app settings",
    capture: true,
    binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
  });
});

test("source import fails closed when a checkpoint is detached from its reviewed path", () => {
  const { map, test: scenario } = fixture();
  const document = intentDocumentFromScenarioTest(map, scenario);
  const path = document.steps[0];
  assert.ok(path?.kind === "path");
  path.checkpointScreenId = "home";
  assert.throws(
    () => applyIntentDocumentToScenarioTest({ map, current: scenario, document }),
    /is not the destination/u,
  );
});
