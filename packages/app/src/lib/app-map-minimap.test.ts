import assert from "node:assert/strict";
import test from "node:test";
import {
  centerCanvasViewport,
  minimapPoint,
  minimapViewportBounds,
  minimapWorldPoint,
} from "./app-map-minimap";

test("minimap projects world positions into a stable percentage space", () => {
  assert.deepEqual(minimapPoint({ x: 600, y: 400 }, { width: 1200, height: 800 }), {
    x: 50,
    y: 50,
  });
  assert.deepEqual(minimapPoint({ x: -20, y: 900 }, { width: 1200, height: 800 }), {
    x: 0,
    y: 100,
  });
  const signedPoint = minimapPoint(
    { x: -400, y: -200 },
    { left: -600, top: -300, width: 1200, height: 800 },
  );
  assert.ok(Math.abs(signedPoint.x - 100 / 6) < 1e-10);
  assert.equal(signedPoint.y, 12.5);
});

test("minimap viewport shows the visible world window and clips overscroll", () => {
  assert.deepEqual(
    minimapViewportBounds(
      { x: -300, y: -200, scale: 1 },
      { width: 600, height: 400 },
      { width: 1200, height: 800 },
    ),
    { left: 25, top: 25, width: 50, height: 50 },
  );
  assert.deepEqual(
    minimapViewportBounds(
      { x: 80, y: 40, scale: 1 },
      { width: 1600, height: 1000 },
      { width: 1200, height: 800 },
    ),
    { left: 0, top: 0, width: 100, height: 100 },
  );
});

test("minimap navigation converts pointer ratios and centers without changing zoom", () => {
  const point = minimapWorldPoint({ x: 0.75, y: 0.25 }, { width: 1200, height: 800 });
  assert.deepEqual(point, { x: 900, y: 200 });
  assert.deepEqual(
    centerCanvasViewport({ x: 0, y: 0, scale: 0.5 }, { width: 800, height: 600 }, point),
    { x: -50, y: 200, scale: 0.5 },
  );
  assert.deepEqual(
    minimapWorldPoint({ x: 0.25, y: 0.5 }, { left: -600, top: -300, width: 1200, height: 800 }),
    { x: -300, y: 100 },
  );
});
