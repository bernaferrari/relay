import assert from "node:assert/strict";
import test from "node:test";
import type { MapTreeNode } from "./app-map-tree";
import {
  canvasBounds,
  canvasEdgeGeometry,
  fitCanvasViewport,
  nextBranchPosition,
  openCanvasViewport,
  screenCardGeometry,
  SCREEN_CARD_WIDTH,
} from "./app-map-canvas-layout";

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
    new RegExp(`^M ${SCREEN_CARD_WIDTH} 117 C`),
  );
});

test("screen previews preserve phone and tablet viewport silhouettes", () => {
  const phone = screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const tablet = screenCardGeometry({ logicalViewport: { width: 1112, height: 834 } });

  assert.ok(phone.frameHeight > phone.frameWidth);
  assert.ok(tablet.frameWidth > tablet.frameHeight);
  assert.equal(phone.frameHeight, 200);
  assert.equal(tablet.frameWidth, SCREEN_CARD_WIDTH);
  assert.ok(phone.frameLeft > 0);
});

test("connections attach to the visible screen frame instead of its layout slot", () => {
  const phoneGeometry = () =>
    screenCardGeometry({ logicalViewport: { width: 1080, height: 2340 } });
  const path = canvasEdgeGeometry(
    { from: "start", to: "settings", kind: "forward" },
    [start, settings],
    (node) => node,
    undefined,
    phoneGeometry,
  ).path;
  const rightEdge = phoneGeometry().frameLeft + phoneGeometry().frameWidth;

  assert.match(path, new RegExp(`^M ${rightEdge}`));
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

test("opening a tall map keeps screen labels readable while Fit remains exact", () => {
  const content = { left: 0, top: -630, width: 1104, height: 1576 };
  const fitted = fitCanvasViewport({ width: 1440, height: 716 }, content);
  const opened = openCanvasViewport({ width: 1440, height: 716 }, content);
  assert.ok(fitted.scale < 0.55);
  assert.equal(opened.scale, 0.55);
  assert.ok(Number.isFinite(opened.x));
  assert.ok(Number.isFinite(opened.y));
});

test("keyboard-created branches occupy the nearest open sibling row", () => {
  const source = { x: 0, y: 0 };
  const branchX = 376;
  const branchY = 278;
  assert.deepEqual(nextBranchPosition(source, [source]), { x: branchX, y: 0 });
  assert.deepEqual(nextBranchPosition(source, [source, { x: branchX, y: 0 }]), {
    x: branchX,
    y: branchY,
  });
  assert.deepEqual(
    nextBranchPosition(source, [source, { x: branchX, y: 0 }, { x: branchX, y: branchY }]),
    { x: branchX, y: -branchY },
  );
});
