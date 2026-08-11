import assert from "node:assert/strict";
import test from "node:test";
import { connectorAutoLanes, connectorPresentationWithAutoLane } from "./app-map-connector-lanes";

test("fans automatic sibling connectors across deterministic source lanes", () => {
  const positions = {
    root: { x: 0, y: 0 },
    top: { x: 320, y: -220 },
    middle: { x: 320, y: 0 },
    bottom: { x: 320, y: 220 },
  };
  const connections = [
    { id: "bottom", fromScreenId: "root", toScreenId: "bottom" },
    { id: "top", fromScreenId: "root", toScreenId: "top" },
    { id: "middle", fromScreenId: "root", toScreenId: "middle" },
  ];
  const lanes = connectorAutoLanes(
    connections,
    (screenId) => positions[screenId as keyof typeof positions],
  );

  assert.deepEqual(lanes.get("top"), { sourceOffset: 0.2 });
  assert.deepEqual(lanes.get("middle"), { sourceOffset: 0.5 });
  assert.deepEqual(lanes.get("bottom"), { sourceOffset: 0.8 });
});

test("manual endpoint choices and recorded anchors retain their exact presentation", () => {
  const positions = {
    root: { x: 0, y: 0 },
    one: { x: 320, y: 0 },
    two: { x: 320, y: 180 },
    three: { x: 320, y: 360 },
  };
  const connections = [
    {
      id: "one",
      fromScreenId: "root",
      toScreenId: "one",
      sourceAnchor: { point: { x: 0.5, y: 0.5 } },
    },
    {
      id: "two",
      fromScreenId: "root",
      toScreenId: "two",
      presentation: { sourcePort: "right" as const, targetPort: "left" as const },
    },
    { id: "three", fromScreenId: "root", toScreenId: "three" },
  ];
  const lanes = connectorAutoLanes(
    connections,
    (screenId) => positions[screenId as keyof typeof positions],
  );

  assert.equal(lanes.get("one")?.sourceOffset, undefined);
  assert.equal(lanes.get("two")?.sourceOffset, undefined);
  assert.equal(lanes.get("three")?.sourceOffset, undefined);
  assert.deepEqual(
    connectorPresentationWithAutoLane(
      { id: "two", presentation: connections[1]!.presentation },
      lanes,
    ),
    { sourcePort: "right", targetPort: "left" },
  );
});
