import assert from "node:assert/strict";
import test from "node:test";
import {
  companionAccessibilityHighlight,
  companionAccessibilityOutlineStyles,
  companionFooterMode,
  companionDisplayedPointToLogical,
  companionFramePresentation,
  companionImageLayout,
  companionLogicalPointToDisplayed,
  companionLogicalRectToDisplayed,
  companionLogicalViewport,
  companionOrientationEdge,
} from "./app-map-device-companion-geometry";

test("projects accessibility outlines and labels through the companion geometry", () => {
  const bounds = { width: 100, height: 200 };
  const nodes = [
    { rect: { x: 10, y: 20, width: 30, height: 40 }, label: "Continue", ref: "action" },
    { rect: { x: 0, y: 0, width: 0, height: 20 } },
  ];

  assert.deepEqual(companionAccessibilityOutlineStyles(nodes, bounds, "none"), [
    { left: "10%", top: "10%", width: "30%", height: "20%" },
  ]);
  assert.deepEqual(companionAccessibilityHighlight(nodes[0], bounds, "none"), {
    rect: { left: "10%", top: "10%", width: "30%", height: "20%" },
    chip: {
      left: "10%",
      top: "10%",
      bottom: "30%",
      below: false,
      text: "Continue · @action",
    },
  });
});

test("corrects a native-portrait iPad capture into its logical landscape viewport", () => {
  const nodes = [
    { depth: 0, rect: { x: 0, y: 0, width: 1112, height: 834 } },
    { depth: 2, rect: { x: 814, y: 0, width: 20, height: 1112 } },
  ];
  const logicalViewport = companionLogicalViewport(nodes);
  const edge = companionOrientationEdge(nodes, logicalViewport);
  const presentation = companionFramePresentation({
    frame: { width: 1668, height: 2220 },
    // XCTest reports points while the screenshot is a 2× pixel buffer.
    logicalViewport,
    platform: "ios",
    edge,
  });

  assert.equal(edge, "right");
  assert.deepEqual(presentation, {
    dimensions: { width: 2220, height: 1668 },
    orientation: "landscape",
    rotation: "left",
  });
  const layout = companionImageLayout(presentation!);
  assert.deepEqual(
    { ...layout, widthPercent: Number(layout.widthPercent.toFixed(3)) },
    {
      aspectRatio: "2220 / 1668",
      widthPercent: 75.135,
      heightPercent: 133.0935251798561,
      rotationDegrees: -90,
    },
  );
});

test("keeps correctly oriented and non-iOS frames unchanged", () => {
  assert.deepEqual(
    companionFramePresentation({
      frame: { width: 1080, height: 2340 },
      logicalViewport: { width: 1080, height: 2340 },
      platform: "android",
      edge: undefined,
    }),
    {
      dimensions: { width: 1080, height: 2340 },
      orientation: "portrait",
      rotation: "none",
    },
  );
});

test("maps input and accessibility overlays through a left-rotated iPad frame", () => {
  assert.deepEqual(companionDisplayedPointToLogical({ x: 0.2, y: 0.7 }, "left"), {
    x: 0.30000000000000004,
    y: 0.2,
  });
  assert.deepEqual(companionLogicalPointToDisplayed({ x: 0.2, y: 0.7 }, "left"), {
    x: 0.7,
    y: 0.8,
  });
  assert.deepEqual(
    companionLogicalRectToDisplayed({ x: 0.25, y: 0.1, width: 0.5, height: 0.2 }, "left"),
    { x: 0.1, y: 0.25, width: 0.2, height: 0.5 },
  );
});

test("maps input and accessibility overlays through a right-rotated iPad frame", () => {
  assert.deepEqual(companionDisplayedPointToLogical({ x: 0.2, y: 0.7 }, "right"), {
    x: 0.7,
    y: 0.8,
  });
  assert.deepEqual(companionLogicalPointToDisplayed({ x: 0.2, y: 0.7 }, "right"), {
    x: 0.30000000000000004,
    y: 0.2,
  });
  assert.deepEqual(
    companionLogicalRectToDisplayed({ x: 0.25, y: 0.1, width: 0.5, height: 0.2 }, "right"),
    { x: 0.7, y: 0.25, width: 0.2, height: 0.5 },
  );
});

test("hides capture while unavailable or while the stage already explains preparation", () => {
  assert.equal(
    companionFooterMode({
      deviceSelected: true,
      canRecord: false,
      arming: false,
      captureBusy: false,
    }),
    "hidden",
  );
  assert.equal(
    companionFooterMode({
      deviceSelected: true,
      canRecord: true,
      arming: true,
      captureBusy: false,
    }),
    "hidden",
  );
  assert.equal(
    companionFooterMode({
      deviceSelected: true,
      canRecord: true,
      arming: false,
      captureBusy: true,
    }),
    "busy",
  );
  assert.equal(
    companionFooterMode({
      deviceSelected: true,
      canRecord: true,
      arming: false,
      captureBusy: false,
    }),
    "ready",
  );
});
