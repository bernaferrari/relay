import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import {
  authoringIntentYamlFilename,
  bindAuthoringIntent,
  formatAuthoringIntentYaml,
  parseAuthoringIntentYaml,
  type AuthoringIntentDocument,
} from "./authoring-intent.js";

function fixture(): { map: AppMap; test: AppMapScenarioTest } {
  const scope = { organizationId: "acme", projectId: "mobile", appMapId: "settings-map" };
  const test: AppMapScenarioTest = {
    ...scope,
    id: "settings-localization",
    name: "Settings localization",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "validation",
        id: "check-no-clipping",
        intent: "No clipping",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: { kind: "expect", target: { identifier: "settings" }, condition: "visible" },
        },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map: AppMap = {
    schemaVersion: 1,
    id: "settings-map",
    organizationId: "acme",
    projectId: "mobile",
    name: "My App",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: { ...scope, id: "home", title: "Home", variantIds: [], createdAt: 1, updatedAt: 1 },
      settings: {
        ...scope,
        id: "settings",
        title: "Data Controls",
        variantIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {},
    connections: {
      open: {
        ...scope,
        id: "open",
        label: "Open settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        state: "ready",
        actions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    caseStacks: {},
    variables: {
      language: {
        ...scope,
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example.app" },
        options: [
          { id: "en", label: "English" },
          { id: "pt-BR", label: "Portuguese (Brazil)" },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    tests: { [test.id]: test },
    combines: {},
    routines: {
      launch: {
        ...scope,
        id: "launch",
        name: "Open app",
        parameters: [],
        actions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
  return { map, test };
}

const source: AuthoringIntentDocument = {
  schemaVersion: 1,
  kind: "authoring-intent",
  name: "Settings localization",
  appMap: "My App",
  test: "Settings localization",
  steps: [
    { id: "launch", intent: "Open app", use: "Open app" },
    {
      id: "open-settings",
      intent: "Open settings",
      path: ["Open settings"],
      checkpoint: "Data Controls",
    },
    {
      id: "check-no-clipping",
      intent: "No clipping",
      check: "No clipping",
    },
  ],
  repeat: {
    dimensions: [{ variable: "Language", values: ["Portuguese (Brazil)"] }],
  },
};

test("friendly authoring intent has its own deterministic source contract", () => {
  const yaml = formatAuthoringIntentYaml(source);
  assert.match(yaml, /^schemaVersion: 1\nkind: authoring-intent\n/u);
  assert.deepEqual(parseAuthoringIntentYaml(yaml), source);
  assert.equal(authoringIntentYamlFilename(source.name), "settings-localization.relay.intent.yaml");
  assert.throws(
    () => parseAuthoringIntentYaml(yaml.replace("kind: authoring-intent", "kind: bound-test")),
    /kind must be authoring-intent/u,
  );
});

test("friendly names bind only when every canonical identity is unique", () => {
  const { map, test: current } = fixture();
  const result = bindAuthoringIntent({ map, current, document: source });
  assert.equal(result.status, "bound");
  if (result.status !== "bound") return;
  assert.deepEqual(result.document.steps, [
    { kind: "module", id: "launch", intent: "Open app", moduleId: "launch" },
    {
      kind: "path",
      id: "open-settings",
      intent: "Open settings",
      connectionIds: ["open"],
      checkpointScreenId: "settings",
    },
    {
      kind: "check",
      id: "check-no-clipping",
      intent: "No clipping",
      testStepId: "check-no-clipping",
    },
  ]);
  assert.deepEqual(result.document.repeat?.dimensions, [{ id: "language", values: ["pt-BR"] }]);
});

test("ambiguous and missing names return review decisions instead of a partial document", () => {
  const { map, test: current } = fixture();
  map.connections.alsoOpen = { ...map.connections.open!, id: "alsoOpen" };
  const unresolved = bindAuthoringIntent({
    map,
    current,
    document: {
      ...source,
      steps: [
        source.steps[1]!,
        { id: "missing-check", intent: "Unknown check", check: "Unknown check" },
      ],
    },
  });

  assert.equal(unresolved.status, "unresolved");
  if (unresolved.status !== "unresolved") return;
  assert.deepEqual(
    unresolved.decisions.map(({ path, reason }) => ({ path, reason })),
    [
      { path: "steps[0].path[0]", reason: "ambiguous" },
      { path: "steps[1].check", reason: "not-found" },
    ],
  );
  assert.equal("document" in unresolved, false);
});
