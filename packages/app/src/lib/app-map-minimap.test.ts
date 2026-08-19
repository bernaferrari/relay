import assert from "node:assert/strict";
import test from "node:test";
import {
  centerCanvasViewport,
  minimapBoxHeight,
  minimapMarkSize,
  minimapPoint,
  minimapViewportBounds,
  minimapWorldPoint,
} from "./app-map-minimap";

test("overview box follows the shape of the map instead of a fixed band", () => {
  assert.equal(minimapBoxHeight({ width: 1760, height: 880 }), 88);
  // A very wide map still gets a usable box rather than a 12px sliver.
  assert.equal(minimapBoxHeight({ width: 9000, height: 600 }), 76);
  // A tall map is capped so the overview cannot swallow the canvas.
  assert.equal(minimapBoxHeight({ width: 600, height: 9000 }), 148);
});

test("marks shrink with density so a crowded map stops reading as a barcode", () => {
  const sparse = minimapMarkSize({ width: 1200, height: 800 }, 118);
  const crowded = minimapMarkSize({ width: 9600, height: 3200 }, 76);
  assert.ok(sparse.width > crowded.width, "a sparse map earns bigger marks");
  assert.ok(crowded.width >= (3 / 176) * 100, "every mark stays at least 3px wide");
  assert.ok(crowded.height >= (3 / 76) * 100, "every mark stays at least 3px tall");
  assert.ok(sparse.width <= 14 && sparse.height <= 14, "no mark may swamp the overview");
});

test("a mark is square in pixels however hard the box stretches the map", () => {
  // The barcode case: a tall 44-screen map drawn into a box that is wider than
  // it is tall. Per-axis sizing turned every screen into a horizontal bar.
  const box = minimapBoxHeight({ width: 1200, height: 5500 });
  const mark = minimapMarkSize({ width: 1200, height: 5500 }, box);
  const pixels = { width: (mark.width / 100) * 176, height: (mark.height / 100) * box };
  assert.ok(
    Math.abs(pixels.width - pixels.height) < 1e-9,
    `mark should be square in pixels, got ${pixels.width}×${pixels.height}`,
  );
  assert.ok(pixels.width >= 3 && pixels.width <= 11, "and stay within the legible range");
});

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
