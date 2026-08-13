import assert from "node:assert/strict";
import test from "node:test";
import {
  foregroundApplicationBundle,
  leadingNavigationPoint,
  localizedLeadingBackPoint,
  mappedTourStopLandmarkPairs,
  mappedTourStopPointPairs,
  mappedTourRowsNeedRefresh,
  mayRestoreTourViewportAfterReturn,
  mergeMappedTourStops,
  missingRequiredTourStops,
  tourMappedRowRecoveryMoves,
  tourViewportRecoveryMoves,
} from "./recipe-runner-tour.js";

test("leading navigation recovery mirrors only the navigation chrome for RTL", () => {
  const frame = { x: 0, y: 0, width: 1080, height: 2340 };
  assert.deepEqual(leadingNavigationPoint(frame, false), { x: 44, y: 132 });
  assert.deepEqual(leadingNavigationPoint(frame, true), { x: 1036, y: 132 });
});

test("localized app Back point requires an observed leading Back affordance", () => {
  assert.deepEqual(
    localizedLeadingBackPoint([
      {
        label: "Indietro",
        rect: { x: 44, y: 148, width: 70, height: 70 },
      },
      {
        label: "Chiudi",
        rect: { x: 44, y: 148, width: 70, height: 70 },
      },
    ]),
    { x: 79, y: 183 },
  );
  assert.equal(
    localizedLeadingBackPoint([
      { label: "Chiudi", rect: { x: 44, y: 148, width: 70, height: 70 } },
    ]),
    undefined,
  );
});

test("parent-list recovery resets upward before seeking the recorded viewport", () => {
  assert.deepEqual(tourViewportRecoveryMoves(), ["up", "up", "down", "down"]);
  assert.equal(
    mayRestoreTourViewportAfterReturn({ interactionSucceeded: false, localized: false }),
    false,
  );
  assert.equal(
    mayRestoreTourViewportAfterReturn({ interactionSucceeded: true, localized: true }),
    false,
  );
  assert.equal(
    mayRestoreTourViewportAfterReturn({
      interactionSucceeded: true,
      localized: true,
      verifiedAppBack: true,
    }),
    true,
  );
  assert.equal(
    mayRestoreTourViewportAfterReturn({ interactionSucceeded: true, localized: false }),
    true,
  );
});

test("a setup-verified tour searches its known parent viewport before calling a row missing", () => {
  assert.deepEqual(tourMappedRowRecoveryMoves(), ["up", "up", "up", "down", "down", "down"]);
  assert.deepEqual(
    missingRequiredTourStops(
      [{ label: "Voice" }, { label: "Data Controls" }],
      [
        { label: "Voice" },
        { label: "Shared Conversations" },
        { label: "Data Controls" },
        { label: "Usage Help", optional: true },
      ],
    ).map((stop) => stop.label),
    ["Shared Conversations"],
  );
  assert.equal(
    mappedTourRowsNeedRefresh([{ label: "Advanced" }], [{ label: "Paste as File" }]),
    true,
  );
  assert.equal(
    mappedTourRowsNeedRefresh([{ label: "Paste as File" }], [{ label: "Paste as File" }]),
    false,
  );
});

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

test("localized point pairing keeps an ordered block when every live row shifts together", () => {
  const live = [
    { label: "Widget", point: { x: 540, y: 360 } },
    { label: "Lingua App", point: { x: 540, y: 524 } },
    { label: "Avanzate", point: { x: 540, y: 688 } },
    { label: "Personalizza Grok", point: { x: 540, y: 1030 } },
    { label: "Connettori", point: { x: 540, y: 1190 } },
    { label: "Abilità", point: { x: 540, y: 1354 } },
    { label: "Memoria", point: { x: 540, y: 1518 } },
    { label: "Modalità Per Bambini", point: { x: 540, y: 1742 } },
  ];
  const mapped = [
    { label: "Customize Grok", point: { x: 381, y: 1194 } },
    { label: "Connectors", point: { x: 310, y: 1358 } },
    { label: "Skills", point: { x: 267, y: 1522 } },
    { label: "Memory", point: { x: 292, y: 1686 } },
  ];
  assert.deepEqual(mappedTourStopPointPairs(live, mapped), live.slice(3, 7));
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
