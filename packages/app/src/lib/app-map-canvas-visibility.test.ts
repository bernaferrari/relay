import assert from "node:assert/strict";
import test from "node:test";
import { canvasEdgeIntersectsVisibleBounds } from "./app-map-canvas-visibility";

const zoomedBounds = { left: 500, top: 500, right: 700, bottom: 700 };

test("keeps a long route mounted when its in-view label outlives both virtualized screens", () => {
  assert.equal(
    canvasEdgeIntersectsVisibleBounds(
      {
        labelPoint: { x: 600, y: 600 },
        hitPoints: [
          { x: -900, y: -900 },
          { x: -800, y: -800 },
        ],
      },
      zoomedBounds,
    ),
    true,
  );
});

test("keeps a route mounted when a long segment crosses the zoomed viewport", () => {
  assert.equal(
    canvasEdgeIntersectsVisibleBounds(
      {
        labelPoint: { x: -400, y: -400 },
        hitPoints: [
          { x: 100, y: 600 },
          { x: 1_000, y: 600 },
        ],
      },
      zoomedBounds,
    ),
    true,
  );
});

test("virtualizes a route that has no visible label or route segment", () => {
  assert.equal(
    canvasEdgeIntersectsVisibleBounds(
      {
        labelPoint: { x: -400, y: -400 },
        hitPoints: [
          { x: -900, y: -900 },
          { x: -800, y: -800 },
        ],
      },
      zoomedBounds,
    ),
    false,
  );
});
