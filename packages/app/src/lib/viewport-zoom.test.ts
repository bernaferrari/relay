import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zoomViewportAtPoint, type CanvasPoint, type CanvasViewport } from "./viewport-zoom";

function worldPoint(viewport: CanvasViewport, point: CanvasPoint): CanvasPoint {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

function assertSamePoint(actual: CanvasPoint, expected: CanvasPoint): void {
  assert.ok(Math.abs(actual.x - expected.x) < 0.000_001);
  assert.ok(Math.abs(actual.y - expected.y) < 0.000_001);
}

describe("zoomViewportAtPoint", () => {
  it("keeps the world point under the cursor still while zooming", () => {
    const viewport = { x: 164, y: 72, scale: 0.72 };
    const cursor = { x: 542, y: 318 };
    const next = zoomViewportAtPoint(viewport, 1.08, cursor);

    assertSamePoint(worldPoint(next, cursor), worldPoint(viewport, cursor));
    assert.notDeepEqual(next, { ...viewport, scale: 1.08 });
  });

  it("works for a zoom-out point near the canvas edge", () => {
    const viewport = { x: -248, y: 126, scale: 1.14 };
    const cursor = { x: 18, y: 604 };
    const next = zoomViewportAtPoint(viewport, 0.48, cursor);

    assertSamePoint(worldPoint(next, cursor), worldPoint(viewport, cursor));
  });
});
