import assert from "node:assert/strict";
import test from "node:test";
import type { MapTreeNode } from "./app-map-tree";
import { canvasBounds, canvasEdgeGeometry, fitCanvasViewport } from "./app-map-canvas-layout";

const start: MapTreeNode = {
  // Geometry is independent from persistence and target dimensions.
  id: "start",
  screenKey: "start",
  title: "Start",
  representativeStepIndex: -1,
  stepIndexes: [],
  depth: 0,
  x: 0,
  y: 0,
};
const settings: MapTreeNode = { ...start, id: "settings", title: "Settings", x: 320, y: 84 };

test("canvas geometry is total while a graph is mid-edit", () => {
  assert.equal(
    canvasEdgeGeometry(
      { from: "missing", to: "settings", kind: "forward" },
      [start, settings],
      (node) => node,
    ).path,
    "",
  );
  assert.match(
    canvasEdgeGeometry(
      { from: "start", to: "settings", kind: "forward" },
      [start, settings],
      (node) => node,
    ).path,
    /^M 180 190 C/,
  );
});

test("fit keeps a graph visible with stable canvas padding", () => {
  const view = fitCanvasViewport({ width: 800, height: 600 }, { width: 1200, height: 800 });
  assert.ok(view.scale > 0 && view.scale <= 1);
  assert.ok(view.x >= 0);
  assert.ok(view.y >= 0);
});

test("fit includes content positioned left and above the world origin", () => {
  const negative = { ...start, x: -420, y: -180 };
  const bounds = canvasBounds([negative, settings], [], (node) => node);
  assert.equal(bounds.left, -420);
  assert.equal(bounds.top, -180);
  const view = fitCanvasViewport({ width: 1000, height: 720 }, bounds);
  assert.ok(negative.x * view.scale + view.x >= 0);
  assert.ok(negative.y * view.scale + view.y >= 0);
});
