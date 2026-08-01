import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyMetadata, RecipeStep } from "@relay/protocol";
import {
  buildJourneyGraphTree,
  commitTakeToJourneyGraph,
  addGraphScreenConnection,
  attachGraphConnectionSteps,
  emptyJourneyGraph,
  ensureJourneyGraph,
  reviewGraphTransition,
  withJourneyGraph,
} from "./journey-graph";

const metadata: JourneyMetadata = {
  schemaVersion: 6,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  graph: emptyJourneyGraph(),
};

const steps: RecipeStep[] = [
  { id: "open-settings", kind: "tap", target: { label: "Settings" } },
  { id: "back", kind: "key", key: "back" },
];

test("a reviewed take creates an explicit start, destination screen, and transition", () => {
  const committed = commitTakeToJourneyGraph(emptyJourneyGraph(), {
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
  const tree = buildJourneyGraphTree(committed.graph, steps);
  assert.equal(tree.nodes[0]?.representativeStepIndex, -1);
  assert.equal(tree.nodes[1]?.representativeStepIndex, 0);
});

test("attaching and replaying a planned transition keeps refinement state on the edge", () => {
  const first = commitTakeToJourneyGraph(emptyJourneyGraph(), { steps: [steps[0]!], at: 10 });
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
  const first = commitTakeToJourneyGraph(emptyJourneyGraph(), { steps: [steps[0]!], at: 10 });
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
  const first = commitTakeToJourneyGraph(emptyJourneyGraph(), { steps: [steps[0]!], at: 10 });
  const start = first.graph.flows[0]!.screenId;
  const second = commitTakeToJourneyGraph(first.graph, {
    sourceScreenId: first.destinationScreenId,
    destination: { kind: "screen", screenId: start },
    steps: [steps[1]!],
    at: 20,
  });
  assert.equal(second.transition.kind, "return");
  assert.deepEqual(second.transition.destination, { kind: "screen", screenId: start });

  const ended = commitTakeToJourneyGraph(second.graph, {
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
  const first = commitTakeToJourneyGraph(emptyJourneyGraph(), {
    sourceObservation: home,
    destinationObservation: settings,
    steps: [steps[0]!],
    at: 10,
  });
  const returned = commitTakeToJourneyGraph(first.graph, {
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
  const first = commitTakeToJourneyGraph(emptyJourneyGraph(), { steps: [steps[0]!], at: 10 });
  const stored = withJourneyGraph(metadata, first.graph);
  const graph = ensureJourneyGraph(stored, steps);
  const tree = buildJourneyGraphTree(graph, steps);
  assert.equal(tree.nodes.length, 2);
  assert.equal(tree.edges.length, 1);
  assert.equal(steps[0]?.kind, "tap");
  assert.equal(steps[1]?.kind, "key");
});

test("v5 recordings migrate lazily without mutating the executable actions", () => {
  const legacy: JourneyMetadata = {
    schemaVersion: 5,
    positions: {},
    edgeLabels: {},
    edgeKinds: {},
  };
  const graph = ensureJourneyGraph(legacy, steps);
  const tree = buildJourneyGraphTree(graph, steps);
  assert.equal(graph.schemaVersion, 1);
  assert.equal(tree.nodes.length, 2);
  assert.equal(tree.nodes[0]?.representativeStepIndex, 0);
  assert.equal(tree.edges.length, 1);
});
