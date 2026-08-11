import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapBatchChange } from "@relay/protocol";
import {
  appMapLoadFailure,
  appMapCommitSummary,
  buildMinimapEdges,
  buildMinimapGroups,
  buildMinimapNodes,
  orderCanvasChanges,
} from "./app-map-workspace-helpers";

test("appMapLoadFailure maps auth, missing, client, and transport failures", () => {
  assert.equal(appMapLoadFailure({ status: 403 }).title, "Relay can’t access this map");
  assert.equal(appMapLoadFailure({ status: 404 }).title, "This map is no longer available");
  assert.equal(appMapLoadFailure({ status: 422 }).title, "Relay couldn’t read this map");
  assert.equal(appMapLoadFailure(new Error("offline")).title, "Relay couldn’t reach this map");
  assert.equal(appMapLoadFailure(new Error("  boom  ")).detail, "boom");
});

test("buildMinimapNodes carries every marquee-selected screen into the overview", () => {
  const nodes = ["ask", "sidebar", "settings"].map((id, index) => ({
    id,
    screenKey: id,
    title: id,
    representativeStepIndex: index,
    stepIndexes: [index],
    depth: 0,
    x: index * 280,
    y: 0,
  }));
  const overview = buildMinimapNodes({
    nodes,
    notes: [],
    bounds: { left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 },
    positionFor: (node) => ({ x: node.x, y: node.y }),
    selectedNodeIds: ["ask", "sidebar"],
    screenStates: {},
  });

  assert.deepEqual(
    overview.filter((node) => node.selected).map((node) => node.id),
    ["ask", "sidebar"],
  );
});

test("buildMinimapNodes includes visible run-matrix objects", () => {
  const overview = buildMinimapNodes({
    nodes: [],
    notes: [],
    matrices: [{ id: "language-settings", position: { x: 400, y: 100 } }],
    bounds: { left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 },
    positionFor: (node) => ({ x: node.x, y: node.y }),
    selectedNodeIds: [],
    screenStates: {},
  });

  assert.equal(overview[0]?.id, "language-settings");
  assert.equal(overview[0]?.kind, "matrix");
});

test("buildMinimapGroups projects variable group regions behind their screens", () => {
  const overview = buildMinimapGroups({
    groups: [{ id: "settings", name: "Settings", screenIds: ["root", "advanced"] }] as never,
    bounds: { left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 },
    positions: { root: { x: 100, y: 100 }, advanced: { x: 340, y: 100 } },
    selectedGroupId: "settings",
  });

  assert.deepEqual(overview, [
    { id: "settings", x: 9, y: 12, width: 67, height: 77.5, selected: true },
  ]);
});

test("buildMinimapEdges keeps the complete graph visible without a selection", () => {
  const nodes = ["settings", "advanced", "paste"].map((id, index) => ({
    id,
    screenKey: id,
    title: id,
    representativeStepIndex: index,
    stepIndexes: [index],
    depth: index,
    x: index * 280,
    y: index * 100,
  }));
  const edges = buildMinimapEdges({
    nodes,
    connections: [
      { id: "settings-advanced", fromScreenId: "settings", toScreenId: "advanced" },
      { id: "advanced-paste", fromScreenId: "advanced", toScreenId: "paste" },
    ] as never,
    bounds: { left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 },
    positionFor: (node) => ({ x: node.x, y: node.y }),
    selectedConnectionId: null,
    transitionStates: {},
  });

  assert.deepEqual(
    edges.map((edge) => edge.id),
    ["settings-advanced", "advanced-paste"],
  );
  assert.equal(
    edges.every((edge) => !edge.selected),
    true,
  );
  assert.equal(
    edges.every((edge) => edge.path.startsWith("M ")),
    true,
  );
  assert.equal(
    edges.every((edge) => / H .* V .* H /.test(edge.path)),
    true,
  );
});

test("orderCanvasChanges keeps stable priority and original order within a tier", () => {
  // Ordering only inspects `kind`; payloads are intentionally incomplete stubs.
  const changes = [
    { kind: "connection.remove", connectionId: "c1" },
    { kind: "screen.update", screenId: "s1", input: {} },
    { kind: "group.remove", groupId: "g1" },
    { kind: "flow.remove", flowId: "f1" },
    { kind: "group.save", group: { id: "g2" } },
    { kind: "connection.create", connection: { id: "c2" } },
    { kind: "screen.add", input: { id: "s2" } },
  ] as AppMapBatchChange[];

  assert.deepEqual(
    orderCanvasChanges(changes).map((change) => change.kind),
    [
      "screen.update",
      "screen.add",
      "group.remove",
      "group.save",
      "connection.create",
      "flow.remove",
      "connection.remove",
    ],
  );
});

test("appMapCommitSummary describes the actual canvas gesture", () => {
  const appMap = {
    screens: {
      settings: { title: "Settings" },
      wifi: { title: "Wi-Fi" },
    },
    connections: {},
    groups: {},
    flows: {},
  } as unknown as AppMap;

  assert.equal(
    appMapCommitSummary({
      appMap,
      changes: [
        {
          kind: "screen.update",
          screenId: "settings",
          input: { patch: { position: { x: 40, y: 80 } } },
        },
      ],
      notesChanged: false,
    }),
    "Moved Settings",
  );
  assert.equal(
    appMapCommitSummary({
      appMap,
      changes: [
        {
          kind: "connection.create",
          connection: {
            id: "open-wifi",
            fromScreenId: "settings",
            destination: { kind: "screen", screenId: "wifi" },
          },
        } as AppMapBatchChange,
      ],
      notesChanged: false,
    }),
    "Connected Settings to Wi-Fi",
  );
  assert.equal(appMapCommitSummary({ appMap, changes: [], notesChanged: true }), "Edited a note");
});
