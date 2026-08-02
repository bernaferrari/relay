import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, JourneyGraph } from "@relay/protocol";
import { mergeAppMapProjection, planAppMapProjection } from "./app-map-projection.js";

const map: AppMap = {
  schemaVersion: 1,
  id: "store",
  organizationId: "acme",
  projectId: "mobile",
  name: "Store",
  revision: 0,
  screens: {},
  screenVariants: {},
  connections: {},
  routines: {},
  flows: {},
  runs: {},
  targetResults: {},
  proposals: {},
  activity: {},
  createdAt: 1,
  updatedAt: 1,
};

const graph: JourneyGraph = {
  schemaVersion: 1,
  screens: [
    { id: "start", title: "Welcome", createdAt: 1, updatedAt: 1 },
    { id: "home", title: "Home", createdAt: 2, updatedAt: 2 },
  ],
  transitions: [
    {
      id: "continue",
      fromScreenId: "start",
      destination: { kind: "screen", screenId: "home" },
      stepIds: ["tap-continue"],
      takeId: "take-1",
      evidenceIds: ["frame-1"],
      state: "recorded",
      kind: "forward",
      createdAt: 3,
      updatedAt: 3,
    },
  ],
  flows: [{ id: "main", name: "Main", screenId: "start", createdAt: 1, updatedAt: 3 }],
};

test("projects a canvas into ordered granular App Map changes", () => {
  const changes = planAppMapProjection({
    appMap: map,
    graph,
    positions: { start: { x: 40, y: 80 }, home: { x: 360, y: 80 } },
    recipeSteps: [{ id: "tap-continue", kind: "tap", target: { label: "Continue" } }],
  });

  assert.deepEqual(
    changes.map((change) => change.kind),
    ["screen.add", "screen.add", "connection.create", "flow.save"],
  );
  const connection = changes.find((change) => change.kind === "connection.create");
  assert.equal(connection?.connection.actions[0]?.kind, "recorded");
  const flow = changes.find((change) => change.kind === "flow.save");
  assert.deepEqual(flow?.flow.connectionIds, ["continue"]);
});

test("does not erase agent-owned entities or emit unchanged canvas fields", () => {
  const first = planAppMapProjection({
    appMap: map,
    graph,
    positions: {},
    recipeSteps: [],
  });
  const projected = structuredClone(map);
  for (const change of first) {
    if (change.kind === "screen.add") projected.screens[change.screen.id] = change.screen;
    if (change.kind === "connection.create")
      projected.connections[change.connection.id] = change.connection;
    if (change.kind === "flow.save") projected.flows[change.flow.id] = change.flow;
  }
  projected.screens.agent = {
    id: "agent",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    title: "Agent proposal preview",
    variantIds: [],
    createdAt: 4,
    updatedAt: 4,
  };

  assert.deepEqual(
    planAppMapProjection({ appMap: projected, graph, positions: {}, recipeSteps: [] }),
    [],
  );
  assert.ok(projected.screens.agent);
});

test("projects approved canonical changes back into the human canvas", () => {
  const projected = structuredClone(map);
  projected.revision = 4;
  projected.screens.start = {
    id: "start",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    title: "Welcome",
    position: { x: 24, y: 48 },
    variantIds: [],
    createdAt: 1,
    updatedAt: 2,
  };
  projected.screens.home = {
    ...projected.screens.start,
    id: "home",
    title: "Home",
    position: { x: 360, y: 48 },
  };
  projected.connections.continue = {
    id: "continue",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    fromScreenId: "start",
    destination: { kind: "screen", screenId: "home" },
    state: "ready",
    actions: [{ id: "back", kind: "back" }],
    createdAt: 2,
    updatedAt: 3,
  };
  projected.flows.main = {
    id: "main",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    name: "Main",
    startScreenId: "start",
    connectionIds: ["continue"],
    createdAt: 1,
    updatedAt: 3,
  };

  const metadata = mergeAppMapProjection(
    {
      schemaVersion: 6,
      positions: {},
      screenTitles: {},
      edgeLabels: {},
      edgeKinds: {},
      notes: [],
      takes: [],
    },
    projected,
  );
  assert.deepEqual(metadata.positions.home, { x: 360, y: 48 });
  assert.equal(metadata.graph?.transitions[0]?.review?.status, "verified");
  assert.equal(metadata.graph?.flows[0]?.screenId, "start");
});
