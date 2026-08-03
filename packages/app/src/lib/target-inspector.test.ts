import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pointForAnchor,
  pointForConstraints,
  recordedNodeHierarchy,
  recordedNodeMatches,
  targetHierarchy,
  targetHighlight,
  targetPointGuide,
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

  it("reconstructs a sibling's structural parent chain", () => {
    const siblingEvidence = {
      ...evidence,
      nodes: [
        {
          ref: "@screen",
          index: 0,
          role: "screen",
          rect: { x: 0, y: 0, width: 100, height: 200 },
        },
        {
          ref: "@row",
          index: 1,
          parentIndex: 0,
          rect: { x: 10, y: 20, width: 80, height: 160 },
        },
        {
          ref: "@child",
          index: 2,
          parentIndex: 1,
          rect: { x: 20, y: 40, width: 40, height: 40 },
        },
        {
          ref: "@sibling",
          index: 3,
          parentIndex: 1,
          rect: { x: 20, y: 100, width: 40, height: 40 },
        },
      ],
    };
    const sibling = siblingEvidence.nodes[3]!;
    assert.deepEqual(
      recordedNodeHierarchy(siblingEvidence, sibling).map((node) => node.ref),
      ["@sibling", "@row", "@screen"],
    );
    assert.equal(recordedNodeMatches(sibling, { ...sibling }), true);
    assert.equal(recordedNodeMatches(sibling, siblingEvidence.nodes[2]), false);
  });

  it("reconstructs sibling ancestry geometrically for older captures", () => {
    const sibling = { ref: "@sibling", rect: { x: 20, y: 100, width: 40, height: 40 } };
    const sparseEvidence = {
      ...evidence,
      nodes: [
        { ref: "@screen", role: "screen", rect: { x: 0, y: 0, width: 100, height: 200 } },
        { ref: "@row", rect: { x: 10, y: 20, width: 80, height: 160 } },
        evidence.node,
        sibling,
      ],
    };
    assert.deepEqual(
      recordedNodeHierarchy(sparseEvidence, sibling).map((node) => node.ref),
      ["@sibling", "@row", "@screen"],
    );
  });

  it("removes duplicate and anonymous full-screen Android wrappers", () => {
    const androidEvidence = {
      id: "android-evidence",
      recordedAt: 1,
      deviceBounds: { width: 1080, height: 2340 },
      node: { ref: "@text", rect: { x: 68, y: 1286, width: 955, height: 60 } },
      ancestors: [
        {
          ref: "@input",
          identifier: "chat_text_input",
          rect: { x: 23, y: 1252, width: 1034, height: 270 },
        },
        { ref: "@wrapper-a", rect: { x: 23, y: 1252, width: 1034, height: 270 } },
        { ref: "@root-a", rect: { x: 0, y: 0, width: 1080, height: 2340 } },
        { ref: "@root-b", rect: { x: 0, y: 0, width: 1080, height: 2340 } },
      ],
    };
    assert.deepEqual(
      targetHierarchy(androidEvidence).map((node) => node.ref),
      ["@text", "@input"],
    );
  });

  it("resolves five safe coordinate anchors inside the selected bounds", () => {
    assert.deepEqual(pointForAnchor(evidence.node, "top-left"), { x: 23, y: 46 });
    assert.deepEqual(pointForAnchor(evidence.node, "top-right"), { x: 57, y: 46 });
    assert.deepEqual(pointForAnchor(evidence.node, "center"), { x: 40, y: 80 });
    assert.deepEqual(pointForAnchor(evidence.node, "bottom-left"), { x: 23, y: 114 });
    assert.deepEqual(pointForAnchor(evidence.node, "bottom-right"), { x: 57, y: 114 });
  });

  it("combines independent horizontal and vertical constraints", () => {
    assert.deepEqual(pointForConstraints(evidence.node, "left", "center"), { x: 23, y: 80 });
    assert.deepEqual(pointForConstraints(evidence.node, "center", "top"), { x: 40, y: 46 });
    assert.deepEqual(pointForConstraints(evidence.node, "right", "bottom"), { x: 57, y: 114 });
  });

  it("maps captured bounds into preview percentages", () => {
    assert.deepEqual(targetHighlight(evidence.node, evidence.deviceBounds), {
      left: "20%",
      top: "20%",
      width: "40%",
      height: "40%",
    });
  });

  it("clamps malformed node bounds to the captured device", () => {
    assert.deepEqual(
      targetHighlight(
        { ref: "@overscan", rect: { x: -10, y: 180, width: 130, height: 40 } },
        evidence.deviceBounds,
      ),
      { left: "0%", top: "90%", width: "100%", height: "10%" },
    );
  });

  it("maps and clamps literal coordinates into preview guides", () => {
    assert.deepEqual(targetPointGuide({ x: 25, y: 150 }, evidence.deviceBounds), {
      left: "25%",
      top: "75%",
      x: 25,
      y: 150,
      horizontalGuide: { left: "0%", width: "25%" },
      verticalGuide: { top: "0%", height: "75%" },
      horizontalOrigin: "0%",
      verticalOrigin: "0%",
    });
    assert.deepEqual(targetPointGuide({ x: 120, y: -10 }, evidence.deviceBounds), {
      left: "100%",
      top: "0%",
      x: 100,
      y: 0,
      horizontalGuide: { left: "0%", width: "100%" },
      verticalGuide: { top: "0%", height: "0%" },
      horizontalOrigin: "0%",
      verticalOrigin: "0%",
    });
    assert.deepEqual(
      targetPointGuide(
        {
          x: 25,
          y: 150,
          anchor: { horizontal: "right", vertical: "bottom" },
        },
        evidence.deviceBounds,
      ),
      {
        left: "25%",
        top: "75%",
        x: 25,
        y: 150,
        horizontalGuide: { left: "25%", width: "75%" },
        verticalGuide: { top: "75%", height: "25%" },
        horizontalOrigin: "100%",
        verticalOrigin: "100%",
      },
    );
  });
});
