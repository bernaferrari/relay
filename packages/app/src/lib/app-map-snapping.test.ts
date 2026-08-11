import assert from "node:assert/strict";
import test from "node:test";
import { snapDraggedScreens, type CanvasSnapFrame } from "./app-map-snapping";

const phone: CanvasSnapFrame = {
  frameLeft: 64,
  frameTop: 30,
  frameWidth: 112,
  frameHeight: 200,
};

const square: CanvasSnapFrame = {
  frameLeft: 0,
  frameTop: 0,
  frameWidth: 100,
  frameHeight: 100,
};

test("snaps the visible preview edge rather than its title or layout slot", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: 0, y: 100 } },
    positions: {
      moving: { x: 0, y: 100 },
      fixed: { x: 400, y: 104 },
    },
    geometries: { moving: phone, fixed: phone },
    candidateDelta: { x: 284, y: 0 },
    threshold: 8,
  });

  // Moving preview right: 0 + 64 + 112 + 288 = fixed preview left: 400 + 64.
  assert.deepEqual(result.delta, { x: 288, y: 4 });
  assert.equal(result.guides.find((guide) => guide.axis === "x")?.position, 464);
});

test("snaps either side of a preview, including moving left to fixed right", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: 600, y: 100 } },
    positions: {
      moving: { x: 600, y: 100 },
      fixed: { x: 400, y: 350 },
    },
    geometries: { moving: phone, fixed: phone },
    candidateDelta: { x: -84, y: 0 },
    threshold: 8,
  });

  // Candidate preview left is 580; fixed preview right is 576.
  assert.equal(result.delta.x, -88);
  assert.equal(result.guides.find((guide) => guide.axis === "x")?.position, 576);
});

test("snaps top and bottom preview edges without including the title", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: 0, y: 0 } },
    positions: {
      moving: { x: 0, y: 0 },
      fixed: { x: 400, y: 330 },
    },
    geometries: { moving: phone, fixed: phone },
    candidateDelta: { x: 0, y: 126 },
    threshold: 8,
  });

  assert.equal(result.delta.y, 130);
  assert.equal(result.guides.find((guide) => guide.axis === "y")?.position, 360);
});

test("snaps after an existing horizontal pair with the same preview gap", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: 404, y: 0 } },
    positions: {
      first: { x: 0, y: 0 },
      second: { x: 200, y: 0 },
      moving: { x: 404, y: 0 },
    },
    geometries: { first: square, second: square, moving: square },
    candidateDelta: { x: -1, y: 0 },
    threshold: 8,
  });

  assert.equal(result.delta.x, -4);
  const guide = result.guides.find(
    (candidate) => candidate.axis === "x" && candidate.kind === "spacing",
  );
  assert.equal(guide?.gap, 100);
  assert.equal(guide?.segments?.length, 2);
});

test("snaps before an existing horizontal pair with the same preview gap", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: -204, y: 0 } },
    positions: {
      moving: { x: -204, y: 0 },
      first: { x: 0, y: 0 },
      second: { x: 200, y: 0 },
    },
    geometries: { first: square, second: square, moving: square },
    candidateDelta: { x: 1, y: 0 },
    threshold: 8,
  });

  assert.equal(result.delta.x, 4);
  assert.ok(
    result.guides.some((candidate) => candidate.axis === "x" && candidate.kind === "spacing"),
  );
});

test("snaps between two previews with equal vertical spacing", () => {
  const result = snapDraggedScreens({
    draggedIds: ["moving"],
    origins: { moving: { x: 0, y: 204 } },
    positions: {
      above: { x: 0, y: 0 },
      moving: { x: 0, y: 204 },
      below: { x: 0, y: 400 },
    },
    geometries: { above: square, moving: square, below: square },
    candidateDelta: { x: 0, y: -1 },
    threshold: 8,
  });

  assert.equal(result.delta.y, -4);
  const guide = result.guides.find(
    (candidate) => candidate.axis === "y" && candidate.kind === "spacing",
  );
  assert.equal(guide?.gap, 100);
});

test("keeps a magnetic relationship stable through small pointer noise", () => {
  const common = {
    draggedIds: ["moving"],
    origins: { moving: { x: 0, y: 0 } },
    positions: {
      moving: { x: 0, y: 0 },
      first: { x: 400, y: 300 },
      second: { x: 406, y: 300 },
    },
    geometries: { moving: phone, first: phone, second: phone },
    threshold: 8,
  } as const;
  const initial = snapDraggedScreens({ ...common, candidateDelta: { x: 284, y: 0 } });
  const noisy = snapDraggedScreens({
    ...common,
    candidateDelta: { x: 292, y: 0 },
    previousLocks: initial.locks,
  });

  assert.equal(noisy.delta.x, 288);
  assert.deepEqual(noisy.locks, initial.locks);
});

test("multi-selection snaps as one visible-preview block", () => {
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
    geometries: { one: phone, two: phone, target: phone },
    candidateDelta: { x: 496, y: 0 },
    threshold: 8,
  });

  assert.deepEqual(result.delta, { x: 500, y: 3 });
});
