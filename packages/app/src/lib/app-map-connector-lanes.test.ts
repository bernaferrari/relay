import assert from "node:assert/strict";
import test from "node:test";
import {
  connectorAutoLanes,
  connectorHasAutomaticSourceLane,
  connectorPresentationWithAutoLane,
} from "./app-map-connector-lanes";
import { screenCardGeometry } from "./app-map-canvas-layout";

test("fans automatic sibling connectors across deterministic source lanes", () => {
  const positions = {
    root: { x: 0, y: 0 },
    top: { x: 320, y: -220 },
    middle: { x: 320, y: 0 },
    bottom: { x: 320, y: 220 },
  };
  const connections = [
    { id: "a-bottom", fromScreenId: "root", toScreenId: "bottom" },
    { id: "z-top", fromScreenId: "root", toScreenId: "top" },
    { id: "m-middle", fromScreenId: "root", toScreenId: "middle" },
  ];
  const lanes = connectorAutoLanes(
    connections,
    (screenId) => positions[screenId as keyof typeof positions],
  );

  // The IDs deliberately sort in the opposite order. A right-side fan must
  // instead follow the destination's top-to-bottom geometry.
  assert.deepEqual(lanes.get("z-top"), { sourceOffset: 0.2 });
  assert.deepEqual(lanes.get("m-middle"), { sourceOffset: 0.5 });
  assert.deepEqual(lanes.get("a-bottom"), { sourceOffset: 0.8 });
});

test("a far-below phone branch keeps the source's rightward fan semantic", () => {
  const positions = {
    root: { x: 0, y: 0 },
    rightTop: { x: 320, y: 0 },
    rightBottom: { x: 320, y: 10 },
    farBelow: { x: 320, y: 720 },
  };
  const phone = screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const lanes = connectorAutoLanes(
    [
      { id: "right-bottom", fromScreenId: "root", toScreenId: "rightBottom" },
      { id: "right-top", fromScreenId: "root", toScreenId: "rightTop" },
      { id: "far-below", fromScreenId: "root", toScreenId: "farBelow" },
    ],
    (screenId) => positions[screenId as keyof typeof positions],
    () => phone,
  );

  // The target is lower but its visible phone frame is still wholly to the
  // right, so all three remain part of the rightward fan. A route may bend
  // around cards, but its target side stays semantically right→left.
  assert.equal(lanes.get("right-top")?.sourceOffset, 0.2);
  assert.equal(lanes.get("right-bottom")?.sourceOffset, 0.5);
  assert.equal(lanes.get("far-below")?.sourceOffset, 0.8);
});

test("source-anchored siblings receive automatic fan lanes", () => {
  const positions = {
    root: { x: 0, y: 0 },
    top: { x: 320, y: -180 },
    middle: { x: 320, y: 0 },
    bottom: { x: 320, y: 180 },
  };
  const connections = [
    {
      id: "bottom",
      fromScreenId: "root",
      toScreenId: "bottom",
      sourceAnchor: { point: { x: 0.5, y: 0.5 } },
    },
    {
      id: "top",
      fromScreenId: "root",
      toScreenId: "top",
      sourceAnchor: { point: { x: 0.5, y: 0.25 } },
    },
    {
      id: "middle",
      fromScreenId: "root",
      toScreenId: "middle",
      sourceAnchor: { point: { x: 0.5, y: 0.75 } },
    },
  ];
  const lanes = connectorAutoLanes(
    connections,
    (screenId) => positions[screenId as keyof typeof positions],
  );

  // Anchor order is the source UI order, even though these destination cards
  // happen to be arranged differently.
  assert.equal(lanes.get("top")?.sourceOffset, 0.2);
  assert.equal(lanes.get("bottom")?.sourceOffset, 0.5);
  assert.equal(lanes.get("middle")?.sourceOffset, 0.8);
  assert.deepEqual(connectorPresentationWithAutoLane({ id: "top" }, lanes), { sourceOffset: 0.2 });
});

test("a recorded source fan follows action order even when cards are arranged differently", () => {
  const positions = {
    root: { x: 0, y: 0 },
    low: { x: 640, y: 200 },
    high: { x: 424, y: -100 },
  };
  const connections = [
    {
      id: "bottom-action-to-high-card",
      fromScreenId: "root",
      toScreenId: "high",
      sourceAnchor: { point: { x: 0.5, y: 0.8 } },
    },
    {
      id: "top-action-to-low-card",
      fromScreenId: "root",
      toScreenId: "low",
      sourceAnchor: { point: { x: 0.5, y: 0.2 } },
    },
  ];

  const lanes = connectorAutoLanes(
    connections,
    (screenId) => positions[screenId as keyof typeof positions],
  );

  // The source controls are top-to-bottom, but the destination cards are
  // bottom-to-top. The fan must still reserve its outer trunk for the first
  // source action so a later action cannot cut across it near the source.
  assert.equal(lanes.get("top-action-to-low-card")?.sourceOffset, 0.2);
  assert.equal(lanes.get("bottom-action-to-high-card")?.sourceOffset, 0.8);
});

test("a same-source fan-in keeps target-side routing hints in source action order", () => {
  const positions = {
    root: { x: 0, y: 0 },
    destination: { x: 640, y: 0 },
  };
  const lanes = connectorAutoLanes(
    [
      {
        id: "bottom-action",
        fromScreenId: "root",
        toScreenId: "destination",
        sourceAnchor: { point: { x: 0.5, y: 0.8 } },
      },
      {
        id: "top-action",
        fromScreenId: "root",
        toScreenId: "destination",
        sourceAnchor: { point: { x: 0.5, y: 0.2 } },
      },
      {
        id: "middle-action",
        fromScreenId: "root",
        toScreenId: "destination",
        sourceAnchor: { point: { x: 0.5, y: 0.5 } },
      },
    ],
    (screenId) => positions[screenId as keyof typeof positions],
  );

  // Target offsets are internal lane guidance only; canvasEdgeGeometry keeps
  // the visible arrow terminal centred on its chosen target edge.
  assert.deepEqual(lanes.get("top-action"), { sourceOffset: 0.2, targetOffset: 0.2 });
  assert.deepEqual(lanes.get("middle-action"), { sourceOffset: 0.5, targetOffset: 0.5 });
  assert.deepEqual(lanes.get("bottom-action"), { sourceOffset: 0.8, targetOffset: 0.8 });
});

test("reciprocal paths use separate lanes instead of drawing doubled arrows", () => {
  const positions = {
    settings: { x: 0, y: 0 },
    birthYear: { x: 640, y: 0 },
  };
  const lanes = connectorAutoLanes(
    [
      { id: "open-birth-year", fromScreenId: "settings", toScreenId: "birthYear" },
      { id: "close-birth-year", fromScreenId: "birthYear", toScreenId: "settings" },
    ],
    (screenId) => positions[screenId as keyof typeof positions],
  );

  assert.deepEqual(lanes.get("close-birth-year"), {
    sourceOffset: 0.42,
    targetOffset: 0.42,
  });
  assert.deepEqual(lanes.get("open-birth-year"), {
    sourceOffset: 0.58,
    targetOffset: 0.58,
  });
});

test("reciprocal lanes never replace explicit endpoint placement", () => {
  const lanes = connectorAutoLanes(
    [
      {
        id: "open",
        fromScreenId: "a",
        toScreenId: "b",
        presentation: { sourceOffset: 0.25 },
      },
      { id: "close", fromScreenId: "b", toScreenId: "a" },
    ],
    (screenId) => (screenId === "a" ? { x: 0, y: 0 } : { x: 640, y: 0 }),
  );

  assert.deepEqual(lanes.get("open"), { targetOffset: 0.58 });
  assert.deepEqual(lanes.get("close"), { sourceOffset: 0.42, targetOffset: 0.42 });
});

test("a selected top-side fan follows destination geometry left-to-right", () => {
  const positions = {
    root: { x: 0, y: 0 },
    left: { x: -240, y: -320 },
    middle: { x: 0, y: -320 },
    right: { x: 240, y: -320 },
  };
  const lanes = connectorAutoLanes(
    [
      {
        id: "a-right",
        fromScreenId: "root",
        toScreenId: "right",
        presentation: { sourcePort: "top" as const },
      },
      {
        id: "z-left",
        fromScreenId: "root",
        toScreenId: "left",
        presentation: { sourcePort: "top" as const },
      },
      {
        id: "m-middle",
        fromScreenId: "root",
        toScreenId: "middle",
        presentation: { sourcePort: "top" as const },
      },
    ],
    (screenId) => positions[screenId as keyof typeof positions],
  );

  assert.equal(lanes.get("z-left")?.sourceOffset, 0.2);
  assert.equal(lanes.get("m-middle")?.sourceOffset, 0.5);
  assert.equal(lanes.get("a-right")?.sourceOffset, 0.8);
});

test("an explicit source offset opts out without suppressing anchored siblings", () => {
  const positions = {
    root: { x: 0, y: 0 },
    top: { x: 320, y: -220 },
    middle: { x: 320, y: 0 },
    bottom: { x: 320, y: 220 },
  };
  const lanes = connectorAutoLanes(
    [
      {
        id: "pinned",
        fromScreenId: "root",
        toScreenId: "middle",
        presentation: { sourcePort: "right" as const, sourceOffset: 0.37 },
      },
      {
        id: "top",
        fromScreenId: "root",
        toScreenId: "top",
        presentation: { sourcePort: "right" as const },
      },
      {
        id: "bottom",
        fromScreenId: "root",
        toScreenId: "bottom",
        sourceAnchor: { point: { x: 0.5, y: 0.75 } },
      },
    ],
    (screenId) => positions[screenId as keyof typeof positions],
  );

  assert.equal(lanes.get("pinned")?.sourceOffset, undefined);
  assert.equal(lanes.get("top")?.sourceOffset, 0.2);
  assert.equal(lanes.get("bottom")?.sourceOffset, 0.8);
  assert.equal(
    connectorHasAutomaticSourceLane(
      {
        id: "pinned",
        presentation: { sourcePort: "right" as const, sourceOffset: 0.37 },
      },
      lanes,
    ),
    false,
  );
});
