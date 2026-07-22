import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode, SnapshotState } from "../lib/api-types";
import { buildTapTarget, semanticTapNode } from "./recorder";

test("resource identifiers are not recorded as accessibility labels", () => {
  assert.deepEqual(
    buildTapTarget(
      { width: 100, height: 200 },
      { identifier: "com.example:id/random_42", ref: "@e9" },
      0.25,
      0.5,
    ),
    {
      ref: "@e9",
      point: {
        x: 25,
        y: 100,
        anchor: { horizontal: "left", vertical: "top" },
        referenceBounds: { width: 100, height: 200 },
      },
    },
  );
});

test("an unlabeled tapped child inherits the closest accessibility label", () => {
  const parent: SnapshotNode = {
    index: 0,
    label: "Account",
    ref: "@e1",
    rect: { x: 0, y: 0, width: 100, height: 50 },
  };
  const child: SnapshotNode = {
    index: 1,
    parentIndex: 0,
    identifier: "com.example:id/icon",
    ref: "@e2",
    rect: { x: 10, y: 10, width: 20, height: 20 },
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [parent, child],
    interactive: [child],
    bounds: { width: 100, height: 200 },
  };

  const semantic = semanticTapNode(snapshot, child);
  assert.equal(semantic, parent);
  assert.deepEqual(buildTapTarget(snapshot.bounds, semantic, 0.2, 0.1), {
    ref: "@e1",
    label: "Account",
    point: {
      x: 20,
      y: 20,
      anchor: { horizontal: "left", vertical: "top" },
      referenceBounds: { width: 100, height: 200 },
    },
  });
});
