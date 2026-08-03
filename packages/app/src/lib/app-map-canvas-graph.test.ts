import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCanvasState, RecipeStep } from "@relay/protocol";

// The canvas projection never becomes a second persisted graph.
import {
  addCanvasScreen,
  addCanvasStartScreen,
  buildCanvasGraphTree,
  commitTakeToCanvasGraph,
  addGraphScreenConnection,
  attachGraphConnectionSteps,
  emptyCanvasGraph,
  ensureCanvasGraph,
  reviewGraphTransition,
  removeCanvasScreen,
  withCanvasGraph,
} from "./app-map-canvas-graph";

const metadata: AppMapCanvasState = {
  schemaVersion: 1,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  graph: emptyCanvasGraph(),
};

const steps: RecipeStep[] = [
  { id: "open-settings", kind: "tap", target: { label: "Settings" } },
  { id: "back", kind: "key", key: "back" },
];

test("the current device screen can become the entry node without an executable action", () => {
  const observation = {
    id: "observation-home",
    fingerprint: "home-fingerprint",
    capturedAt: 10,
    source: "recording" as const,
    deviceId: "device-1",
  };
  const captured = addCanvasStartScreen(emptyCanvasGraph(), observation, { at: 10 });

  assert.equal(captured.graph.screens.length, 1);
  assert.equal(captured.graph.transitions.length, 0);
  assert.equal(captured.graph.flows[0]?.screenId, captured.screen.id);
  assert.deepEqual(captured.screen.observations, [observation]);
  assert.equal(buildCanvasGraphTree(captured.graph, []).nodes[0]?.representativeStepIndex, -1);
  assert.throws(() => addCanvasStartScreen(captured.graph, observation, { at: 20 }));
});

test("removing a screen removes its canvas routes and entry flow without deleting recipe steps", () => {
  const committed = commitTakeToCanvasGraph(emptyCanvasGraph(), {
    steps: [steps[0]!],
    at: 10,
  });
  const removed = removeCanvasScreen(committed.graph, committed.destinationScreenId!);

  assert.equal(removed.screens.length, 1);
  assert.equal(removed.transitions.length, 0);
  assert.equal(removed.flows.length, 1);
  assert.equal(steps[0]?.id, "open-settings");

  const withoutStart = removeCanvasScreen(committed.graph, committed.graph.flows[0]!.screenId);
  assert.equal(withoutStart.flows.length, 0);
  assert.equal(withoutStart.transitions.length, 0);
});

test("capturing a screen creates unique nodes and refreshes matching observations", () => {
  const home = {
    id: "observation-home-1",
    fingerprint: "home-fingerprint",
    capturedAt: 10,
    source: "recording" as const,
  };
  const first = addCanvasScreen(emptyCanvasGraph(), home, { at: 10 });
  const settings = addCanvasScreen(
    first.graph,
    {
      id: "observation-settings",
      fingerprint: "settings-fingerprint",
      capturedAt: 20,
      source: "recording" as const,
    },
    { title: "Settings", at: 20 },
  );
  const refreshed = addCanvasScreen(settings.graph, {
    ...home,
    id: "observation-home-2",
    capturedAt: 30,
  });

  assert.equal(first.created, true);
  assert.equal(settings.created, true);
  assert.equal(settings.screen.title, "Settings");
  assert.equal(refreshed.created, false);
  assert.equal(refreshed.graph.screens.length, 2);
  assert.equal(refreshed.screen.observations?.length, 2);
  assert.equal(refreshed.graph.transitions.length, 0);
});

test("default sibling screens never overlap", () => {
  const first = addCanvasStartScreen(
    emptyCanvasGraph(),
    { id: "home", fingerprint: "home", capturedAt: 1, source: "recording" },
    { at: 1 },
  );
  const settings = addGraphScreenConnection(
    first.graph,
    { fromScreenId: first.screen.id, title: "Settings", position: { x: 420, y: 80 } },
    2,
  );
  const profile = addGraphScreenConnection(
    settings.graph,
    { fromScreenId: first.screen.id, title: "Profile", position: { x: 420, y: 440 } },
    3,
  );
  const siblings = buildCanvasGraphTree(profile.graph, []).nodes.filter((node) => node.depth === 1);
  assert.equal(siblings.length, 2);
  assert.ok(Math.abs(siblings[0]!.y - siblings[1]!.y) >= 350);
});

test("a reviewed take creates an explicit start, destination screen, and transition", () => {
  const committed = commitTakeToCanvasGraph(emptyCanvasGraph(), {
    steps: [steps[0]!],
    takeId: "take-1",
    videoTakeId: "video-1",
    videoClip: { startMs: 200, endMs: 1_800 },
    mode: "interaction",
    review: { status: "verified", updatedAt: 10, verifiedAt: 10 },
    at: 10,
  });
  assert.equal(committed.graph.screens.length, 2);
  assert.equal(committed.graph.flows.length, 1);
  assert.equal(committed.transition.stepIds[0], "open-settings");
  assert.equal(committed.transition.takeId, "take-1");
  assert.equal(committed.transition.videoTakeId, "video-1");
  assert.deepEqual(committed.transition.videoClip, { startMs: 200, endMs: 1_800 });
  assert.equal(committed.transition.mode, "interaction");
  assert.equal(committed.transition.review?.status, "verified");
  assert.equal(committed.transition.destination.kind, "screen");
  assert.equal(committed.destinationScreenId, committed.graph.screens[1]?.id);
  const tree = buildCanvasGraphTree(committed.graph, steps);
  assert.equal(tree.nodes[0]?.representativeStepIndex, -1);
  assert.equal(tree.nodes[1]?.representativeStepIndex, 0);
});

test("attaching and replaying a planned transition keeps refinement state on the edge", () => {
  const first = commitTakeToCanvasGraph(emptyCanvasGraph(), { steps: [steps[0]!], at: 10 });
  const planned = addGraphScreenConnection(
    first.graph,
    { fromScreenId: first.destinationScreenId!, position: { x: 500, y: 100 } },
    20,
  );
  const attached = attachGraphConnectionSteps(
    planned.graph,
    planned.transition.id,
    [steps[1]!],
    {
      mode: "automatic",
      videoTakeId: "video-edge",
      videoClip: { startMs: 100, endMs: 900 },
    },
    30,
  );
  const draftTransition = attached.transitions.find(
    (transition) => transition.id === planned.transition.id,
  );
  assert.equal(draftTransition?.mode, "automatic");
  assert.equal(draftTransition?.review?.status, "draft");
  assert.deepEqual(draftTransition?.videoClip, { startMs: 100, endMs: 900 });

  const verified = reviewGraphTransition(
    attached,
    planned.transition.id,
    { status: "verified" },
    40,
  );
  assert.equal(
    verified.transitions.find((transition) => transition.id === planned.transition.id)?.review
      ?.verifiedAt,
    40,
  );
});

test("dropping a connector on blank canvas creates a planned destination", () => {
  const first = commitTakeToCanvasGraph(emptyCanvasGraph(), { steps: [steps[0]!], at: 10 });
  const added = addGraphScreenConnection(
    first.graph,
    {
      fromScreenId: first.destinationScreenId!,
      title: "Checkout",
      position: { x: 640, y: 180 },
    },
    20,
  );
  assert.equal(added.screen.title, "Checkout");
  assert.equal(added.transition.fromScreenId, first.destinationScreenId);
  assert.deepEqual(added.transition.destination, { kind: "screen", screenId: added.screen.id });
  assert.equal(added.transition.state, "needs-recording");
  assert.deepEqual(added.position, { x: 640, y: 180 });
});

test("a reviewed take can explicitly return to an existing screen or end a flow", () => {
  const first = commitTakeToCanvasGraph(emptyCanvasGraph(), { steps: [steps[0]!], at: 10 });
  const start = first.graph.flows[0]!.screenId;
  const second = commitTakeToCanvasGraph(first.graph, {
    sourceScreenId: first.destinationScreenId,
    destination: { kind: "screen", screenId: start },
    steps: [steps[1]!],
    at: 20,
  });
  assert.equal(second.transition.kind, "return");
  assert.deepEqual(second.transition.destination, { kind: "screen", screenId: start });

  const ended = commitTakeToCanvasGraph(second.graph, {
    sourceScreenId: first.destinationScreenId,
    destination: { kind: "end" },
    steps: [],
    at: 30,
  });
  assert.deepEqual(ended.transition.destination, { kind: "end" });
  assert.equal(ended.destinationScreenId, undefined);
});

test("recording observations resolve repeated screens without creating duplicate nodes", () => {
  const home = {
    id: "observation-home-1",
    fingerprint: "home-fingerprint",
    capturedAt: 10,
    source: "recording" as const,
  };
  const settings = {
    id: "observation-settings-1",
    fingerprint: "settings-fingerprint",
    capturedAt: 20,
    source: "recording" as const,
  };
  const first = commitTakeToCanvasGraph(emptyCanvasGraph(), {
    sourceObservation: home,
    destinationObservation: settings,
    steps: [steps[0]!],
    at: 10,
  });
  const returned = commitTakeToCanvasGraph(first.graph, {
    sourceScreenId: first.destinationScreenId,
    sourceObservation: settings,
    destinationObservation: { ...home, id: "observation-home-2", capturedAt: 30 },
    steps: [steps[1]!],
    at: 30,
  });

  assert.equal(returned.graph.screens.length, 2);
  assert.equal(returned.transition.kind, "return");
  assert.deepEqual(returned.transition.destination, {
    kind: "screen",
    screenId: returned.graph.flows[0]!.screenId,
  });
  assert.equal(returned.graph.screens[0]?.observations?.length, 2);
});

test("graph layout and recipe execution stay separate", () => {
  const first = commitTakeToCanvasGraph(emptyCanvasGraph(), { steps: [steps[0]!], at: 10 });
  const stored = withCanvasGraph(metadata, first.graph);
  const graph = ensureCanvasGraph(stored, steps);
  const tree = buildCanvasGraphTree(graph, steps);
  assert.equal(tree.nodes.length, 2);
  assert.equal(tree.edges.length, 1);
  assert.equal(steps[0]?.kind, "tap");
  assert.equal(steps[1]?.kind, "key");
});
