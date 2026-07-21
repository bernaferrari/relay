import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pointForAnchor,
  targetHierarchy,
  targetHighlight,
  targetNodeIndex,
} from "./target-inspector";

const evidence = {
  id: "evidence-1",
  recordedAt: 1,
  deviceBounds: { width: 100, height: 200 },
  node: { ref: "@child", rect: { x: 20, y: 40, width: 40, height: 80 } },
  ancestors: [{ ref: "@parent", rect: { x: 10, y: 20, width: 80, height: 160 } }],
};

describe("target inspector evidence model", () => {
  it("walks from the captured node toward its parents", () => {
    assert.deepEqual(
      targetHierarchy(evidence).map((node) => node.ref),
      ["@child", "@parent"],
    );
    assert.equal(targetNodeIndex(evidence, { ref: "@parent" }), 1);
  });

  it("resolves five safe coordinate anchors inside the selected bounds", () => {
    assert.deepEqual(pointForAnchor(evidence.node, "top-left"), { x: 23, y: 46 });
    assert.deepEqual(pointForAnchor(evidence.node, "top-right"), { x: 57, y: 46 });
    assert.deepEqual(pointForAnchor(evidence.node, "center"), { x: 40, y: 80 });
    assert.deepEqual(pointForAnchor(evidence.node, "bottom-left"), { x: 23, y: 114 });
    assert.deepEqual(pointForAnchor(evidence.node, "bottom-right"), { x: 57, y: 114 });
  });

  it("maps captured bounds into preview percentages", () => {
    assert.deepEqual(targetHighlight(evidence.node, evidence.deviceBounds), {
      left: "20%",
      top: "20%",
      width: "40%",
      height: "40%",
    });
  });
});
