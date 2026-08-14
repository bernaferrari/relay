import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stablePointAnchorForNode, targetFromStrategy } from "./snapshot";

describe("element-relative point authoring", () => {
  it("records the exact fractional point inside a stable element", () => {
    const anchor = stablePointAnchorForNode({
      identifier: "language-row",
      label: "Language",
      rect: { x: 20, y: 300, width: 320, height: 80 },
    });
    assert.deepEqual(anchor, {
      target: { identifier: "language-row" },
      rect: { x: 20, y: 300, width: 320, height: 80 },
    });
    assert.deepEqual(
      targetFromStrategy(
        { id: "point", kind: "point", x: 260, y: 320, describe: "260, 320" },
        260 / 360,
        320 / 800,
        { width: 360, height: 800 },
        { horizontal: "left", vertical: "top" },
        anchor,
      ),
      {
        point: {
          x: 260,
          y: 320,
          anchor: { horizontal: "left", vertical: "top" },
          referenceBounds: { width: 360, height: 800 },
          relativeTo: {
            target: { identifier: "language-row" },
            xRatio: 0.75,
            yRatio: 0.25,
          },
        },
      },
    );
  });

  it("does not advertise translated labels or frame refs as stable anchors", () => {
    assert.equal(
      stablePointAnchorForNode({
        ref: "@frame-12",
        label: "Language",
        rect: { x: 20, y: 300, width: 320, height: 80 },
      }),
      undefined,
    );
  });
});
