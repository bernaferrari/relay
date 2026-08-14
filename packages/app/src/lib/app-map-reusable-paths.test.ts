import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Connection, Flow } from "@relay/protocol";
import {
  makeReusablePathFromRecording,
  recordedPathCandidates,
  sameRecordedPathConnectionIds,
} from "./app-map-reusable-paths";

const at = 10;

function connection(
  id: string,
  fromScreenId: string,
  destination: string,
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id,
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    fromScreenId,
    destination: { kind: "screen", screenId: destination },
    state: "ready",
    actions: [{ id: `tap-${id}`, kind: "tap", target: { label: destination } }],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function flow(id: string, connectionIds: string[]): Flow {
  return {
    id,
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: id,
    startScreenId: "saved",
    connectionIds,
    createdAt: at,
    updatedAt: at,
  };
}

function map(overrides: Partial<AppMap> = {}): AppMap {
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 1,
    screens: {
      home: {
        id: "home",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
      menu: {
        id: "menu",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Menu",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
      settings: {
        id: "settings",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Settings",
        identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
      usage: {
        id: "usage",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Usage",
        identity: { schemaVersion: 1, fingerprint: "d".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
      advanced: {
        id: "advanced",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Advanced",
        identity: { schemaVersion: 1, fingerprint: "e".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
      saved: {
        id: "saved",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        title: "Saved",
        identity: { schemaVersion: 1, fingerprint: "f".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    notes: {},
    groups: {},
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
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

test("turns unowned ready recordings into explicit linear reusable-path choices", () => {
  const value = map({
    connections: {
      "home-menu": connection("home-menu", "home", "menu"),
      "menu-settings": connection("menu-settings", "menu", "settings"),
      "settings-usage": connection("settings-usage", "settings", "usage"),
      "settings-advanced": connection("settings-advanced", "settings", "advanced"),
      draft: connection("draft", "usage", "advanced", { state: "draft" }),
      owned: connection("owned", "saved", "usage"),
    },
    flows: { existing: flow("existing", ["owned"]) },
  });

  assert.deepEqual(
    recordedPathCandidates(value).map((candidate) => ({
      name: candidate.name,
      connectionIds: candidate.connectionIds,
      screenCount: candidate.screenCount,
    })),
    [
      { name: "Home → Settings", connectionIds: ["home-menu", "menu-settings"], screenCount: 3 },
      { name: "Settings → Advanced", connectionIds: ["settings-advanced"], screenCount: 2 },
      { name: "Settings → Usage", connectionIds: ["settings-usage"], screenCount: 2 },
    ],
  );
});

test("creates a durable flow and test without treating a recording as already runnable", () => {
  const value = map({
    connections: { "home-menu": connection("home-menu", "home", "menu") },
  });
  const candidate = recordedPathCandidates(value)[0]!;
  const reusable = makeReusablePathFromRecording(value, candidate, 20);

  assert.deepEqual(reusable.flow.connectionIds, ["home-menu"]);
  assert.equal(reusable.flow.startScreenId, "home");
  assert.match(reusable.flow.name, /^Reusable path: Home → Menu$/);
  assert.equal(reusable.test.kind, "scenario");
  assert.equal(reusable.test.steps[0]?.kind, "instruction");
  assert.deepEqual(reusable.test.steps[0]?.binding, {
    status: "resolved",
    kind: "connections",
    connectionIds: ["home-menu"],
  });
  assert.equal(reusable.test.name, "Home → Menu");
  assert.equal(reusable.test.createdAt, 20);
});

test("does not offer a recording as reusable until every traversed screen has an approved identity", () => {
  const value = map({
    connections: { "home-menu": connection("home-menu", "home", "menu") },
  });
  const candidate = recordedPathCandidates(value)[0]!;
  delete value.screens.menu!.identity;

  assert.deepEqual(recordedPathCandidates(value), []);
  assert.throws(
    () => makeReusablePathFromRecording(value, candidate, 20),
    /until every screen is verified/u,
  );
});

test("matches the full ordered connection sequence instead of a colliding display hash", () => {
  const firstId = "ce3wmq314ao";
  const secondId = "ceqx6hn4df3";
  const value = map({
    connections: {
      [firstId]: connection(firstId, "home", "menu"),
      [secondId]: connection(secondId, "usage", "advanced"),
    },
  });
  const candidates = recordedPathCandidates(value);
  const first = candidates.find((candidate) => candidate.connectionIds[0] === firstId)!;
  const second = candidates.find((candidate) => candidate.connectionIds[0] === secondId)!;

  assert.equal(first.id, second.id, "the compact display ids intentionally collide");
  assert.equal(sameRecordedPathConnectionIds(first, second.connectionIds), false);
  assert.equal(sameRecordedPathConnectionIds(second, second.connectionIds), true);
  assert.deepEqual(
    candidates.find((candidate) => sameRecordedPathConnectionIds(candidate, second.connectionIds))
      ?.connectionIds,
    [secondId],
  );
});

test("allocates separate names and ids when an older reusable path uses the default", () => {
  const value = map({
    connections: { "home-menu": connection("home-menu", "home", "menu") },
    flows: {
      "flow-recording-any": {
        ...flow("flow-recording-any", []),
        name: "Reusable path: Home → Menu",
      },
    },
    tests: {
      "test-recording-any": {
        id: "test-recording-any",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        name: "Home → Menu",
        kind: "path",
        flowId: "flow-recording-any",
        createdAt: at,
        updatedAt: at,
      },
    },
  });
  const reusable = makeReusablePathFromRecording(value, recordedPathCandidates(value)[0]!, 20);

  assert.equal(reusable.flow.name, "Reusable path: Home → Menu 2");
  assert.equal(reusable.test.name, "Home → Menu 2");
  assert.notEqual(reusable.flow.id, "flow-recording-any");
  assert.notEqual(reusable.test.id, "test-recording-any");
});
