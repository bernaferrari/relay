import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCanvasState, RecipeStep } from "@relay/protocol";
import { buildMapTree } from "./app-map-tree";

// Draft connections stay explicitly unapproved until recording review.
import {
  addPlannedConnection,
  attachRecordedTake,
  attachTransitionSteps,
  canvasConnections,
  removeAuthoredConnection,
  reviewTransition,
  setMapBaseline,
} from "./app-map-connection-draft";

const steps: RecipeStep[] = [
  {
    id: "open",
    kind: "tap",
    target: { label: "Open" },
    evidence: {
      id: "evidence-a",
      recordedAt: 1,
      screenshot: { recipeId: "take", id: "a", capturedAt: 1, mime: "image/png", sha256: "a" },
    },
  },
  {
    id: "close",
    kind: "tap",
    target: { label: "Close" },
    evidence: {
      id: "evidence-b",
      recordedAt: 2,
      screenshot: { recipeId: "take", id: "b", capturedAt: 2, mime: "image/png", sha256: "b" },
    },
  },
];

const recordedTree = buildMapTree(steps);
const metadata: AppMapCanvasState = {
  schemaVersion: 1,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  graph: {
    schemaVersion: 1,
    screens: recordedTree.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      representativeStepId: steps[node.representativeStepIndex]?.id,
      createdAt: 1,
      updatedAt: 1,
    })),
    transitions: recordedTree.edges.map((edge) => ({
      id: edge.id,
      fromScreenId: edge.from,
      destination: { kind: "screen" as const, screenId: edge.to },
      stepIds: steps[edge.stepIndex]?.id ? [steps[edge.stepIndex]!.id!] : [],
      label: edge.label,
      state: "recorded" as const,
      kind: edge.kind,
      createdAt: 1,
      updatedAt: 1,
    })),
    flows: recordedTree.nodes[0]
      ? [
          {
            id: "flow-main",
            name: "Main flow",
            screenId: recordedTree.nodes[0].id,
            createdAt: 1,
            updatedAt: 1,
          },
        ]
      : [],
  },
};

test("derived connections retain the runnable action identity", () => {
  const tree = buildMapTree(steps);
  const connection = canvasConnections(tree, steps, metadata)[0];
  assert.equal(connection?.stepId, "open");
  assert.equal(connection?.state, "recorded");
  assert.equal(connection?.source, "derived");
});

test("recorded connections derive a normalized source target from tap evidence", () => {
  const sourceStep: RecipeStep = {
    id: "source-tap",
    kind: "tap",
    target: { label: "Open", point: { x: 200, y: 400 } },
    evidence: {
      id: "source-evidence",
      recordedAt: 1,
      deviceBounds: { width: 1_000, height: 2_000 },
      pointer: { x: 220, y: 420 },
      node: {
        label: "Open",
        role: "button",
        rect: { x: 120, y: 360, width: 240, height: 120 },
      },
    },
  };
  const nextStep: RecipeStep = {
    id: "next",
    kind: "sleep",
    ms: 200,
    evidence: {
      id: "next-evidence",
      recordedAt: 2,
      screenshot: { recipeId: "take", id: "next", capturedAt: 2, mime: "image/png", sha256: "n" },
    },
  };
  const tree = buildMapTree([sourceStep, nextStep]);
  const connection = canvasConnections(tree, [sourceStep, nextStep], {
    ...metadata,
    graph: undefined,
  } as AppMapCanvasState)[0];

  assert.deepEqual(connection?.sourceAnchor, {
    point: { x: 0.22, y: 0.21 },
    rect: { x: 0.12, y: 0.18, width: 0.24, height: 0.06 },
  });
});

test("planned connections are reversible and become recorded only after a stable step id exists", () => {
  const tree = buildMapTree(steps);
  const [from, to] = tree.nodes;
  const planned = addPlannedConnection(
    metadata,
    { fromScreenId: from!.id, toScreenId: to!.id },
    10,
    steps,
  );
  // The recorded route remains alongside the newly sketched route. Select the
  // actual pending route instead of assuming it is the first transition.
  const pending = planned.graph?.transitions.find(
    (transition) => transition.state === "needs-recording",
  );
  assert.equal(pending?.state, "needs-recording");

  const attached = attachRecordedTake(
    planned,
    pending!.id,
    {
      id: "take-transition",
      steps,
      videoTakeId: "video-transition",
      videoClip: { startMs: 250, endMs: 1_500 },
    },
    20,
  );
  const recorded = attached.graph?.transitions.find((transition) => transition.id === pending!.id);
  assert.deepEqual(recorded?.stepIds, ["open", "close"]);
  assert.equal(recorded?.takeId, "take-transition");
  assert.equal(recorded?.videoTakeId, "video-transition");
  assert.deepEqual(recorded?.videoClip, { startMs: 250, endMs: 1_500 });
  assert.equal(recorded?.mode, "interaction");
  assert.equal(recorded?.review?.status, "draft");
  assert.equal(recorded?.state, "recorded");

  const removed = removeAuthoredConnection(attached, pending!.id);
  assert.equal(
    removed.graph?.transitions.some((transition) => transition.id === pending!.id),
    false,
  );
  // The recorded route is independent evidence, not part of the authored
  // connection we just removed.
  assert.equal(removed.graph?.transitions.length, 1);
});

test("visual quick behaviors remain replayable and independently reviewable", () => {
  const tree = buildMapTree(steps);
  const [from, to] = tree.nodes;
  const planned = addPlannedConnection(
    metadata,
    { fromScreenId: from!.id, toScreenId: to!.id },
    10,
    steps,
  );
  const pending = planned.graph!.transitions.find(
    (transition) => transition.state === "needs-recording",
  )!;
  const automaticStep: RecipeStep = { id: "wait-next", kind: "sleep", ms: 750 };
  const attached = attachTransitionSteps(planned, pending.id, [automaticStep], "automatic", 20);
  const reviewed = reviewTransition(attached, pending.id, { status: "verified" }, 30);
  const connection = canvasConnections(
    buildMapTree([...steps, automaticStep]),
    [...steps, automaticStep],
    reviewed,
  ).find((candidate) => candidate.id === pending.id);

  assert.equal(connection?.mode, "automatic");
  assert.equal(connection?.review?.status, "verified");
  assert.deepEqual(connection?.stepIds, ["wait-next"]);
});

test("a baseline is a canvas decision and never alters the executable recipe", () => {
  const baseline = setMapBaseline(metadata, "baselined", 30);
  assert.equal(baseline.prototype?.verification?.state, "baselined");
  assert.equal(baseline.prototype?.verification?.baselineAt, 30);
  assert.equal(steps[0]?.id, "open");
});
