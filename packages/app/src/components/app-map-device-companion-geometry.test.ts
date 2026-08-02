import assert from "node:assert/strict";
import test from "node:test";
import {
  companionFooterMode,
  companionFramePresentation,
  companionImageLayout,
  companionLogicalViewport,
  companionOrientationEdge,
} from "./app-map-device-companion-geometry";

test("corrects a native-portrait iPad capture into its logical landscape viewport", () => {
  const nodes = [
    { depth: 0, rect: { x: 0, y: 0, width: 1112, height: 834 } },
    { depth: 2, rect: { x: 814, y: 0, width: 20, height: 1112 } },
  ];
  const logicalViewport = companionLogicalViewport(nodes);
  const edge = companionOrientationEdge(nodes, logicalViewport);
  const presentation = companionFramePresentation({
    frame: { width: 1668, height: 2220 },
    logicalViewport: logicalViewport && {
      width: logicalViewport.width * 2,
      height: logicalViewport.height * 2,
    },
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
