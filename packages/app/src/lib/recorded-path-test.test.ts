import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { testFromRecordedPath } from "./recorded-path-test";

function fixture(state: "draft" | "ready" = "ready"): AppMap {
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Example",
    revision: 4,
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
        destination: { kind: "screen", screenId: "settings" },
        state,
        actions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
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
}

test("a reviewed recording becomes one runnable Test with destination evidence", () => {
  const created = testFromRecordedPath({
    map: fixture(),
    connectionId: "open",
    testId: "test",
    stepId: "step",
    at: 10,
  });
  assert.deepEqual(created, {
    id: "test",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: "Home to Settings",
    kind: "scenario",
    intentSchemaVersion: 1,
    capture: { mode: "final-screen" },
    steps: [
      {
        id: "step",
        kind: "instruction",
        intent: "Go from Home to Settings",
        capture: true,
        binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
      },
    ],
    createdAt: 10,
    updatedAt: 10,
  });
});

test("an unreviewed recording cannot be promoted into a runnable Test", () => {
  assert.equal(testFromRecordedPath({ map: fixture("draft"), connectionId: "open" }), undefined);
});
