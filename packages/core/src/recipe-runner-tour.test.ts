import assert from "node:assert/strict";
import test from "node:test";
import { foregroundApplicationBundle, mergeMappedTourStops } from "./recipe-runner-tour.js";

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

test("exact tours merge partial accessibility with mapped point fallbacks", () => {
  const editProfile = { label: "Edit Profile", point: { x: 281, y: 425 } };
  const usage = { label: "Usage", point: { x: 281, y: 742 } };
  const liveUsage = { label: "Usage", point: { x: 540, y: 744 } };
  assert.deepEqual(
    mergeMappedTourStops(
      [liveUsage, { label: "Unmapped row", point: { x: 1, y: 1 } }],
      [editProfile, usage],
    ),
    [editProfile, liveUsage],
  );
});

test("exact tours pair fully translated rows by current screen order", () => {
  const merged = mergeMappedTourStops(
    [
      { label: "الملف الشخصي", point: { x: 540, y: 420 } },
      { label: "الاستخدام", point: { x: 540, y: 810 } },
    ],
    [
      { label: "Edit Profile", point: { x: 281, y: 425 } },
      { label: "Usage", point: { x: 281, y: 742 } },
    ],
    { alignByOrder: true },
  );
  assert.deepEqual(merged, [
    { label: "Edit Profile", point: { x: 540, y: 420 } },
    { label: "Usage", point: { x: 540, y: 810 } },
  ]);
});
