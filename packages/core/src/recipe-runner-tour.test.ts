import assert from "node:assert/strict";
import test from "node:test";
import { foregroundApplicationBundle } from "./recipe-runner-tour.js";

test("foreground app ranking ignores a smaller keyboard accessibility window", () => {
  assert.equal(
    foregroundApplicationBundle([
      {
        bundleId: "com.android.systemui",
        rect: { x: 0, y: 0, width: 1080, height: 2340 },
      },
      {
        bundleId: "ai.x.grok",
        rect: { x: 0, y: 0, width: 1080, height: 2340 },
      },
      {
        bundleId: "com.touchtype.swiftkey",
        rect: { x: 0, y: 1500, width: 1080, height: 840 },
      },
    ]),
    "ai.x.grok",
  );
});

test("foreground app ranking still detects a full-screen launcher handoff", () => {
  assert.equal(
    foregroundApplicationBundle([
      {
        bundleId: "com.android.systemui",
        rect: { x: 0, y: 2205, width: 1080, height: 135 },
      },
      {
        bundleId: "bitpit.launcher",
        rect: { x: 0, y: 0, width: 1080, height: 2340 },
      },
    ]),
    "bitpit.launcher",
  );
});
