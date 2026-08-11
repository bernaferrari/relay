import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasGridForScale,
  canvasGridPresentation,
  snapCanvasDeltaToGrid,
  snapCanvasPointToGrid,
} from "./app-map-grid";

test("zooms out onto a coarser visible grid without changing the snap lattice", () => {
  const close = canvasGridForScale(1);
  const far = canvasGridForScale(0.42);

  assert.equal(close.spacing, 20);
  assert.deepEqual(far, close);
  assert.equal(canvasGridPresentation({ x: 0, y: 0, scale: 1 }, close).visualSpacing, 20);
  assert.equal(canvasGridPresentation({ x: 0, y: 0, scale: 0.42 }, far).visualSpacing, 40);
});

test("snaps absolute points on both sides of the document origin", () => {
  const grid = { spacing: 20, origin: { x: 4, y: -6 } };

  assert.deepEqual(snapCanvasPointToGrid({ x: 15, y: -17 }, grid), { x: 24, y: -26 });
  assert.deepEqual(snapCanvasPointToGrid({ x: -9, y: 7 }, grid), { x: -16, y: 14 });
});

test("quantizes the resulting position rather than a relative delta", () => {
  const delta = snapCanvasDeltaToGrid({ x: 13, y: 17 }, { x: 8, y: 9 }, { spacing: 20 });

  assert.deepEqual(delta, { x: 7, y: 3 });
});

test("grid dots retain their world phase while the canvas pans", () => {
  const presentation = canvasGridPresentation(
    { x: -13, y: 47, scale: 0.5 },
    { spacing: 40, origin: { x: 8, y: -4 } },
  );

  assert.equal(presentation.screenSpacing, 20);
  assert.equal(presentation.visualSpacing, 40);
  assert.deepEqual(presentation.offset, { x: 11, y: 5 });
});
