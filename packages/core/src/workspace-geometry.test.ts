import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import {
  inferIosSnapshotGeometry,
  inferSnapshotBounds,
  normalizeIosSnapshotNodes,
  normalizeScreenshotToBounds,
} from "./workspace.js";

test("uses the XCTest application root as the logical iPad viewport", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      depth: 0,
      type: "Application",
      enabled: true,
      hittable: true,
      rect: { x: 0, y: 0, width: 1112, height: 834 },
    },
    {
      index: 1,
      parentIndex: 0,
      depth: 1,
      type: "Window",
      enabled: true,
      hittable: true,
      rect: { x: 0, y: 0, width: 834, height: 1112 },
    },
  ];

  assert.deepEqual(inferSnapshotBounds(nodes, "ios"), { width: 1112, height: 834 });
  assert.deepEqual(inferSnapshotBounds(nodes, "android"), { width: 1112, height: 1112 });
  const geometry = inferIosSnapshotGeometry(nodes);
  assert.deepEqual(geometry, { rotation: "left", logicalWidth: 1112, logicalHeight: 834 });
});

test("normalizes XCTest child rectangles into the logical landscape viewport", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      depth: 0,
      type: "Application",
      enabled: true,
      rect: { x: 0, y: 0, width: 1112, height: 834 },
    },
    {
      index: 1,
      parentIndex: 0,
      depth: 1,
      type: "Window",
      enabled: true,
      rect: { x: 0, y: 0, width: 834, height: 1112 },
    },
    {
      index: 2,
      parentIndex: 1,
      depth: 2,
      type: "Element(44)",
      label: "Settings",
      enabled: true,
      rect: { x: 498, y: 600, width: 87.5, height: 68.5 },
    },
  ];

  const normalized = normalizeIosSnapshotNodes(nodes);
  assert.deepEqual(normalized[0]?.rect, { x: 0, y: 0, width: 1112, height: 834 });
  assert.deepEqual(normalized[1]?.rect, { x: 0, y: 0, width: 1112, height: 834 });
  assert.deepEqual(normalized[2]?.rect, {
    x: 600,
    y: 248.5,
    width: 68.5,
    height: 87.5,
  });
});

test("falls back to observed extents when an iOS root is unavailable", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      depth: 0,
      type: "Window",
      enabled: true,
      hittable: true,
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
  ];

  assert.deepEqual(inferSnapshotBounds(nodes, "ios"), { width: 390, height: 844 });
});

test("rotates a portrait Apple frame into its logical landscape bounds", () => {
  const source = new PNG({ width: 2, height: 3 });
  const colors = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
    [255, 0, 255, 255],
    [0, 255, 255, 255],
  ];
  colors.forEach((color, index) => source.data.set(color, index * 4));

  const normalized = PNG.sync.read(
    normalizeScreenshotToBounds(PNG.sync.write(source), { width: 3, height: 2 }),
  );

  assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 3, height: 2 });
  assert.deepEqual(
    [...normalized.data],
    [
      0, 255, 0, 255, 255, 255, 0, 255, 0, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255, 255, 0,
      255, 255,
    ],
  );
});

test("rotates scaled physical-iPad pixels when their orientation opposes logical bounds", () => {
  const source = new PNG({ width: 4, height: 6 });
  const normalized = PNG.sync.read(
    normalizeScreenshotToBounds(PNG.sync.write(source), { width: 1112, height: 834 }),
  );

  assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 6, height: 4 });
});
