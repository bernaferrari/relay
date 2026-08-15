import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import { compileScrollSurfaceSemanticIndex } from "./scroll-surface-semantic-index.js";

test("compiles unique semantic document order while excluding sticky chrome", () => {
  const snapshot = (nodes: SnapshotNode[]) => ({
    serial: "device",
    capturedAt: 1,
    nodes,
    interactive: [],
    bounds: { width: 400, height: 800 },
    inspectable: true,
    source: "sdk" as const,
    screenIdentity: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
  });
  const index = compileScrollSurfaceSemanticIndex({
    nodes: [
      { identifier: "title", label: "Settings", rect: { x: 0, y: 40, width: 300, height: 40 } },
      {
        identifier: "appearance",
        label: "Appearance",
        rect: { x: 0, y: 240, width: 300, height: 60 },
      },
      {
        identifier: "kids-mode",
        label: "Kids Mode",
        rect: { x: 0, y: 1_480, width: 300, height: 60 },
      },
    ],
    frames: [
      {
        offsetY: 0,
        screenshot: { base64: "", width: 400, height: 800, capturedAt: 1 },
        snapshot: snapshot([
          { identifier: "title", rect: { x: 0, y: 40, width: 300, height: 40 } },
          { identifier: "appearance", rect: { x: 0, y: 240, width: 300, height: 60 } },
        ]),
      },
      {
        offsetY: 700,
        screenshot: { base64: "", width: 400, height: 800, capturedAt: 2 },
        snapshot: snapshot([
          { identifier: "title", rect: { x: 0, y: 40, width: 300, height: 40 } },
          { identifier: "kids-mode", rect: { x: 0, y: 780, width: 300, height: 60 } },
        ]),
      },
    ],
  });

  assert.deepEqual(index.anchors, [
    { order: 0, documentY: 270, target: { identifier: "appearance" } },
    { order: 1, documentY: 1_510, target: { identifier: "kids-mode" } },
  ]);
  assert.equal(index.documentHeight, 1_511);
  assert.equal(index.viewportHeight, 800);
});
