import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAppMapOperationResult, type AppMap } from "./app-map.js";

test("App Map command summaries preserve topology without semantic evidence", () => {
  const appMap: AppMap = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "local",
    projectId: "project-1",
    name: "Checkout",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: {
        organizationId: "local",
        projectId: "project-1",
        appMapId: "map-1",
        id: "home",
        title: "Home",
        variantIds: ["home-phone"],
        createdAt: 1,
        updatedAt: 2,
      },
    },
    screenVariants: {
      "home-phone": {
        organizationId: "local",
        projectId: "project-1",
        appMapId: "map-1",
        id: "home-phone",
        screenId: "home",
        targetProfile: {
          id: "phone",
          targetId: "phone",
          source: "device",
          platform: "ios",
          name: "Phone",
          capabilities: [],
          observedAt: 2,
        },
        observation: {
          fingerprint: "fingerprint",
          nodes: [{ role: "button", label: "Secret generated content" }],
          volatileSignals: [],
        },
        evidenceIds: ["large-private-evidence"],
        createdAt: 1,
        updatedAt: 2,
      },
    },
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
    updatedAt: 2,
  };

  const summary = summarizeAppMapOperationResult("app-map.get", { appMap });
  assert.deepEqual(summary, {
    appMap: {
      id: "map-1",
      name: "Checkout",
      revision: 3,
      screens: [{ id: "home", title: "Home", variantCount: 1 }],
      connections: [],
      groups: [],
      flows: [],
      variables: [],
      tests: [],
      combines: [],
      counts: {
        screens: 1,
        variants: 1,
        connections: 0,
        groups: 0,
        caseStacks: 0,
        variables: 0,
        tests: 0,
        combines: 0,
        routines: 0,
        flows: 0,
        runs: 0,
        targetResults: 0,
        proposals: 0,
      },
      createdAt: 1,
      updatedAt: 2,
    },
  });
  assert.equal(JSON.stringify(summary).includes("Secret generated content"), false);

  const catalog = summarizeAppMapOperationResult("app-map.list", { appMaps: [appMap] });
  assert.deepEqual(catalog, {
    appMaps: [
      {
        id: "map-1",
        name: "Checkout",
        revision: 3,
        counts: { screens: 1, variants: 1, connections: 0, flows: 0 },
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  });
  assert.equal(JSON.stringify(catalog).includes("Secret generated content"), false);

  const exported = summarizeAppMapOperationResult("app-map.export", {
    appMap,
    yaml: "version: 1\n",
  }) as { yaml: string; appMap: unknown };
  assert.equal(exported.yaml, "version: 1\n");
  assert.equal(JSON.stringify(exported.appMap).includes("Secret generated content"), false);
});

test("non-map operation results remain untouched", () => {
  const value = { ok: true };
  assert.equal(summarizeAppMapOperationResult("target.list", value), value);
  const malformedMap = { appMap: { id: "map-1" }, yaml: "version: 1\n" };
  assert.equal(summarizeAppMapOperationResult("app-map.export", malformedMap), malformedMap);
  const malformedCatalog = { appMaps: [{ id: "map-1" }] };
  assert.equal(summarizeAppMapOperationResult("app-map.list", malformedCatalog), malformedCatalog);
});

test("App Map summaries expose complete modifier values and matrix evidence policy", () => {
  const scope = {
    organizationId: "local",
    projectId: "project-1",
    appMapId: "map-1",
    createdAt: 1,
    updatedAt: 2,
  };
  const appMap = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "local",
    projectId: "project-1",
    name: "Grok",
    revision: 4,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {
      language: {
        ...scope,
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "ai.x.grok" },
        options: [
          { id: "en-US", label: "English (United States)" },
          { id: "it-IT", label: "Italiano" },
        ],
      },
    },
    tests: {
      settings: {
        ...scope,
        id: "settings",
        name: "Settings sweep",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [],
        capture: { mode: "every-screen" },
      },
    },
    combines: {
      matrix: {
        ...scope,
        id: "matrix",
        name: "Locales × settings",
        variableIds: ["language"],
        testIds: ["settings"],
        selected: { language: ["en-US", "it-IT"] },
        captures: { settings: { mode: "every-screen" } },
        strategy: "cartesian",
      },
    },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 2,
  } satisfies AppMap;

  const result = summarizeAppMapOperationResult("app-map.get", { appMap }) as {
    appMap: {
      variables: Array<{ options: Array<{ id: string; label?: string }> }>;
      combines: Array<{
        formula: string;
        selectedCounts: Record<string, number>;
        captures: Record<string, unknown>;
      }>;
    };
  };
  assert.deepEqual(result.appMap.variables[0]?.options, [
    { id: "en-US", label: "English (United States)" },
    { id: "it-IT", label: "Italiano" },
  ]);
  assert.equal(result.appMap.combines[0]?.formula, "Language × Settings sweep");
  assert.deepEqual(result.appMap.combines[0]?.selectedCounts, { language: 2 });
  assert.deepEqual(result.appMap.combines[0]?.captures, {
    settings: { mode: "every-screen" },
  });
});
