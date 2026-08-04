import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAppMapOperationResult, type AppMap } from "./app-map.js";

test("App Map command summaries preserve topology without semantic evidence", () => {
  const appMap: AppMap = {
    schemaVersion: 2,
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
      counts: {
        screens: 1,
        variants: 1,
        connections: 0,
        groups: 0,
        caseStacks: 0,
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
});
