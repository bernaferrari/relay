import assert from "node:assert/strict";
import test from "node:test";
import { SCREEN_CARD_HEIGHT, SCREEN_CARD_WIDTH } from "./app-map-canvas-layout";
import { snapDraggedScreens } from "./app-map-snapping";

test("dragging snaps screen edges and exposes one alignment guide", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: 100, y: 300 } },
    positions: {
      moving: { x: 100, y: 300 },
      fixed: { x: 504, y: 304 },
    },
    candidateDelta: { x: 400, y: 0 },
    threshold: 8,
  });

  assert.deepEqual(result.delta, { x: 404, y: 4 });
  assert.equal(result.guides.filter((guide) => guide.kind === "alignment").length, 2);
});

test("dragging between two cards snaps to equal vertical spacing", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: 200, y: 410 } },
    positions: {
      above: { x: 200, y: 0 },
      moving: { x: 200, y: 410 },
      below: { x: 200, y: 2 * (SCREEN_CARD_HEIGHT + 180) },
    },
    candidateDelta: { x: 0, y: 4 },
    threshold: 8,
  });

  assert.equal(result.delta.y, 0);
  const guide = result.guides.find(
    (candidate) => candidate.axis === "y" && candidate.kind === "spacing",
  );
  assert.ok(guide);
  assert.equal(guide.segments?.length, 2);
  assert.equal(
    (guide.segments?.[0]?.end ?? 0) - (guide.segments?.[0]?.start ?? 0),
    (guide.segments?.[1]?.end ?? 0) - (guide.segments?.[1]?.start ?? 0),
  );
});

test("dragging between two cards snaps to equal horizontal spacing", () => {
  const gap = 160;
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: SCREEN_CARD_WIDTH + gap, y: 200 } },
    positions: {
      left: { x: 0, y: 200 },
      moving: { x: SCREEN_CARD_WIDTH + gap, y: 200 },
      right: { x: 2 * (SCREEN_CARD_WIDTH + gap), y: 200 },
    },
    candidateDelta: { x: -4, y: 0 },
    threshold: 8,
  });

  assert.equal(result.delta.x, 0);
  const guide = result.guides.find(
    (candidate) => candidate.axis === "x" && candidate.kind === "spacing",
  );
  assert.ok(guide);
  assert.equal(guide.segments?.length, 2);
});

test("multi-selection snaps as one block without considering its own members", () => {
  const result = snapDraggedScreens({
    draggedIds: ["one", "two"],
    origins: {
      one: { x: 0, y: 0 },
      two: { x: 0, y: 300 },
    },
    positions: {
      one: { x: 0, y: 0 },
      two: { x: 0, y: 300 },
      target: { x: 500, y: 3 },
    },
    candidateDelta: { x: 496, y: 0 },
    threshold: 8,
  });

  assert.deepEqual(result.delta, { x: 500, y: 3 });
});
