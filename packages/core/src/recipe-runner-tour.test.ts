import assert from "node:assert/strict";
import test from "node:test";
import {
  foregroundApplicationBundle,
  mappedTourStopLandmarkPairs,
  mappedTourStopPointPairs,
  mergeMappedTourStops,
} from "./recipe-runner-tour.js";

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
    { label: "الملف الشخصي", point: { x: 540, y: 420 } },
    { label: "الاستخدام", point: { x: 540, y: 810 } },
  ]);
});

test("exact localized tours select a recorded subset by nearby live row points", () => {
  const live = [
    { label: "Modalità Per Bambini", point: { x: 540, y: 488 } },
    { label: "Preferenze NSFW", point: { x: 540, y: 652 } },
    { label: "Voce", point: { x: 540, y: 972 } },
    { label: "Conversazioni Condivise", point: { x: 540, y: 1291 } },
    { label: "Controllo Dati", point: { x: 540, y: 1455 } },
    { label: "Licenze Open Source", point: { x: 540, y: 1734 } },
  ];
  const mapped = [
    { label: "NSFW Preferences", point: { x: 540, y: 650 } },
    { label: "Voice", point: { x: 540, y: 970 } },
    { label: "Shared Conversations", point: { x: 540, y: 1290 } },
    { label: "Data Controls", point: { x: 540, y: 1450 } },
  ];
  assert.deepEqual(mappedTourStopPointPairs(live, mapped), [live[1], live[2], live[3], live[4]]);
  assert.deepEqual(mergeMappedTourStops(live, mapped, { alignByPoint: true }), [
    live[1],
    live[2],
    live[3],
    live[4],
  ]);
});

test("localized point pairing refuses a stale coordinate instead of guessing", () => {
  assert.equal(
    mappedTourStopPointPairs(
      [{ label: "Live", point: { x: 540, y: 300 } }],
      [{ label: "Mapped", point: { x: 540, y: 800 } }],
    ),
    undefined,
  );
});

test("localized exact subsets use complete recorded row order as calibration", () => {
  const live = [
    { label: "Modalità Per Bambini", point: { x: 540, y: 488 } },
    { label: "Preferenze NSFW", point: { x: 540, y: 652 } },
    { label: "Voce", point: { x: 540, y: 972 } },
    { label: "Conversazioni Condivise", point: { x: 540, y: 1291 } },
    { label: "Controllo Dati", point: { x: 540, y: 1455 } },
  ];
  const landmarks = [
    { label: "Kids Mode", point: { x: 540, y: 500 } },
    { label: "NSFW Preferences", point: { x: 540, y: 650 } },
    { label: "Voice", point: { x: 540, y: 800 } },
    { label: "Shared Conversations", point: { x: 540, y: 960 } },
    { label: "Data Controls", point: { x: 540, y: 1120 } },
  ];
  const selected = [landmarks[1]!, landmarks[2]!, landmarks[3]!, landmarks[4]!];
  assert.deepEqual(mappedTourStopLandmarkPairs(live, selected, landmarks), live.slice(1));
  assert.deepEqual(
    mergeMappedTourStops(live, selected, { landmarkStops: landmarks }),
    live.slice(1),
  );
});
