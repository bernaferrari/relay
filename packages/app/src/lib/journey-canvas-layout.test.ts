import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyTreeNode } from "./journey-tree";
import { canvasEdgeGeometry, fitCanvasViewport } from "./journey-canvas-layout";

const start: JourneyTreeNode = {
  id: "start",
  screenKey: "start",
  title: "Start",
  representativeStepIndex: -1,
  stepIndexes: [],
  depth: 0,
  x: 0,
  y: 0,
};
const settings: JourneyTreeNode = { ...start, id: "settings", title: "Settings", x: 320, y: 84 };

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
    /^M 196 124 C/,
  );
});

test("fit keeps a graph visible with stable canvas padding", () => {
  const view = fitCanvasViewport({ width: 800, height: 600 }, { width: 1200, height: 800 });
  assert.ok(view.scale > 0 && view.scale <= 1);
  assert.ok(view.x >= 0);
  assert.ok(view.y >= 0);
});
