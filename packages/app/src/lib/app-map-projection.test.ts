import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, CanvasGraph, ScreenVariant } from "@relay/protocol";
import {
  connectionStepsFromActions,
  mergeAppMapProjection,
  planAppMapProjection,
} from "./app-map-projection.js";

test("canonical taps remain simple canvas interactions", () => {
  assert.deepEqual(
    connectionStepsFromActions([
      {
        id: "open-settings",
        kind: "tap",
        target: {
          label: "Settings",
          point: { x: 900, y: 1800, referenceBounds: { width: 1080, height: 2340 } },
        },
      },
    ]),
    [
      {
        id: "open-settings",
        kind: "tap",
        target: {
          label: "Settings",
          point: { x: 900, y: 1800, referenceBounds: { width: 1080, height: 2340 } },
        },
      },
    ],
  );
});

const map: AppMap = {
  schemaVersion: 1,
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

const graph: CanvasGraph = {
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

const startVariant: ScreenVariant = {
  id: "variant-start-android",
  organizationId: "acme",
  projectId: "mobile",
  appMapId: "store",
  screenId: "start",
  targetProfile: {
    id: "profile-pixel",
    targetId: "pixel",
    source: "device",
    platform: "android",
    name: "Pixel",
    viewport: { width: 1080, height: 2340 },
    capabilities: ["screenshot"],
    observedAt: 4,
  },
  evidenceIds: ["evidence-start"],
  evidenceUris: ["relay-evidence://captures/start.png"],
  createdAt: 4,
  updatedAt: 4,
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

test("round trips durable connector presentation", () => {
  const styledGraph = structuredClone(graph);
  const presentation = {
    route: "curve" as const,
    strokeWidth: 3 as const,
    arrow: "end" as const,
    sourcePort: "right" as const,
    sourceOffset: 0.2,
    targetPort: "left" as const,
    targetOffset: 0.8,
    controlOffset: { x: 12, y: -8 },
  };
  styledGraph.transitions[0]!.presentation = presentation;

  const changes = planAppMapProjection({
    appMap: map,
    graph: styledGraph,
    positions: {},
    recipeSteps: [],
  });
  const create = changes.find((change) => change.kind === "connection.create");
  assert.deepEqual(create?.connection.presentation, presentation);

  const observed = structuredClone(map);
  for (const change of changes) {
    if (change.kind === "screen.add") {
      observed.screens[change.input.screen.id] = change.input.screen;
    } else if (change.kind === "connection.create") {
      observed.connections[change.connection.id] = change.connection;
    } else if (change.kind === "flow.save") {
      observed.flows[change.flow.id] = change.flow;
    }
  }

  const projected = mergeAppMapProjection(
    { schemaVersion: 1, positions: {}, edgeLabels: {}, edgeKinds: {} },
    observed,
  );
  assert.deepEqual(projected.graph?.transitions[0]?.presentation, presentation);
});

test("read projection follows observed order instead of opaque entity ids", () => {
  const observed = structuredClone(map);
  observed.screens["z-first"] = {
    id: "z-first",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    title: "First observed",
    variantIds: [],
    createdAt: 10,
    updatedAt: 10,
  };
  observed.screens["a-second"] = {
    ...observed.screens["z-first"],
    id: "a-second",
    title: "Second observed",
    createdAt: 20,
    updatedAt: 20,
  };

  const projected = mergeAppMapProjection(
    { schemaVersion: 1, positions: {}, edgeLabels: {}, edgeKinds: {} },
    observed,
  );

  assert.deepEqual(
    projected.graph?.screens.map((screen) => screen.id),
    ["z-first", "a-second"],
  );
});

test("projects a recorded tap into the transition so every map view can show it", () => {
  const observed = structuredClone(map);
  observed.screens.start = {
    id: "start",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    title: "Connections",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  observed.screens.wifi = {
    ...observed.screens.start,
    id: "wifi",
    title: "Wi-Fi",
    createdAt: 2,
    updatedAt: 2,
  };
  const tap = {
    id: "tap-wifi",
    kind: "tap" as const,
    target: {
      point: {
        x: 250,
        y: 390,
        referenceBounds: { width: 1080, height: 2340 },
      },
    },
    evidence: {
      id: "evidence-wifi",
      recordedAt: 3,
      deviceBounds: { width: 1080, height: 2340 },
      pointer: { x: 270, y: 420 },
      node: {
        label: "Wi-Fi",
        role: "button",
        rect: { x: 120, y: 360, width: 300, height: 120 },
      },
    },
  };
  observed.connections.open = {
    id: "open",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    fromScreenId: "start",
    destination: { kind: "screen", screenId: "wifi" },
    state: "ready",
    actions: [
      {
        id: "recorded-open",
        kind: "recorded",
        takeId: "take-open",
        takeRevision: 1,
        steps: [tap],
        evidenceIds: [],
      },
    ],
    createdAt: 3,
    updatedAt: 3,
  };

  const projected = mergeAppMapProjection(
    { schemaVersion: 1, positions: {}, edgeLabels: {}, edgeKinds: {} },
    observed,
  );

  assert.deepEqual(projected.graph?.transitions[0]?.sourceAnchor, {
    point: { x: 270 / 1080, y: 420 / 2340 },
    rect: { x: 120 / 1080, y: 360 / 2340, width: 300 / 1080, height: 120 / 2340 },
  });
});

test("projects durable connection source evidence ahead of inferred step evidence", () => {
  const observed = structuredClone(map);
  observed.connections.open = {
    id: "open",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    fromScreenId: "start",
    destination: { kind: "screen", screenId: "wifi" },
    state: "ready",
    actions: [
      {
        id: "recorded-open",
        kind: "recorded",
        takeId: "take-open",
        takeRevision: 1,
        steps: [
          {
            id: "tap-wifi",
            kind: "tap",
            target: { point: { x: 100, y: 200, referenceBounds: { width: 1000, height: 2000 } } },
            evidence: {
              id: "evidence-wifi",
              recordedAt: 3,
              deviceBounds: { width: 1000, height: 2000 },
              pointer: { x: 100, y: 200 },
            },
          },
        ],
        evidenceIds: [],
      },
    ],
    sourceAnchor: {
      point: { x: 0.8, y: 0.35 },
      rect: { x: 0.2, y: 0.3, width: 0.6, height: 0.1 },
    },
    createdAt: 3,
    updatedAt: 3,
  };

  const projected = mergeAppMapProjection(
    { schemaVersion: 1, positions: {}, edgeLabels: {}, edgeKinds: {} },
    observed,
  );

  assert.deepEqual(projected.graph?.transitions[0]?.sourceAnchor, {
    point: { x: 0.8, y: 0.35 },
    rect: { x: 0.2, y: 0.3, width: 0.6, height: 0.1 },
  });
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
    if (change.kind === "screen.add")
      projected.screens[change.input.screen.id] = change.input.screen;
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

test("canvas persistence never rewrites executable actions or branch paths", () => {
  const projected = structuredClone(map);
  projected.screens.start = {
    id: "start",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    title: "Welcome",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  projected.screens.home = {
    ...projected.screens.start,
    id: "home",
    title: "Home",
    createdAt: 2,
    updatedAt: 2,
  };
  projected.connections.continue = {
    id: "continue",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    fromScreenId: "start",
    destination: { kind: "screen", screenId: "home" },
    state: "ready",
    actions: [
      {
        id: "recording:take-1",
        kind: "recorded",
        takeId: "take-1",
        takeRevision: 2,
        steps: [{ id: "tap-continue", kind: "tap", target: { label: "Continue" } }],
        evidenceIds: ["frame-1"],
      },
    ],
    createdAt: 3,
    updatedAt: 3,
  };
  projected.flows.main = {
    id: "main",
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "store",
    name: "Main",
    startScreenId: "start",
    connectionIds: ["continue", "branch-after-continue"],
    createdAt: 1,
    updatedAt: 3,
  };

  assert.deepEqual(
    planAppMapProjection({
      appMap: projected,
      graph,
      positions: {},
      // Simulate reopening before the editor has loaded canonical Take steps.
      recipeSteps: [],
    }),
    [],
  );
});

test("persists captured evidence with a new screen and refreshes an existing screen", () => {
  const first = planAppMapProjection({
    appMap: map,
    graph,
    positions: {},
    recipeSteps: [],
    variantsByScreen: { start: [startVariant] },
  });
  const add = first.find(
    (change) => change.kind === "screen.add" && change.input.screen.id === "start",
  );
  assert.equal(add?.kind, "screen.add");
  if (add?.kind !== "screen.add") return;
  assert.deepEqual(add.input.screen.variantIds, [startVariant.id]);
  assert.deepEqual(add.input.variants, [startVariant]);

  const projected = structuredClone(map);
  projected.screens.start = structuredClone(add.input.screen);
  projected.screenVariants[startVariant.id] = structuredClone(startVariant);
  const refreshed = {
    ...startVariant,
    evidenceIds: ["evidence-start-new"],
    evidenceUris: ["relay-evidence://captures/start-new.png"],
    updatedAt: 5,
  };
  const updates = planAppMapProjection({
    appMap: projected,
    graph: { ...graph, screens: [graph.screens[0]!], transitions: [], flows: [] },
    positions: {},
    recipeSteps: [],
    variantsByScreen: { start: [refreshed] },
  });
  assert.deepEqual(updates, [
    {
      kind: "screen.update",
      screenId: "start",
      input: { patch: {}, upsertVariants: [refreshed] },
    },
  ]);
});

test("projects canonical ready connections as runnable canvas paths", () => {
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
    setup: { routineId: "start-clean", bindings: { account: "qa" } },
    connectionIds: ["continue"],
    createdAt: 1,
    updatedAt: 3,
  };

  const metadata = mergeAppMapProjection(
    {
      schemaVersion: 1,
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
  assert.deepEqual(metadata.graph?.flows[0]?.setup, {
    routineId: "start-clean",
    bindings: { account: "qa" },
  });
  assert.deepEqual(
    planAppMapProjection({
      appMap: projected,
      graph: metadata.graph!,
      positions: metadata.positions,
      recipeSteps: [],
    }),
    [],
  );
});
