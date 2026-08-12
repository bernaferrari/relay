import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTourStops,
  onTourOrigin,
  sameTourScreen,
  tourFallbackOverlap,
  tourScreenSignature,
} from "./tour.js";

test("depth-0 tour walks settings cells and skips chrome plus language rows", () => {
  const stops = extractTourStops(
    [
      {
        type: "Button",
        label: "Close",
        hittable: false,
        rect: { x: 80, y: 70, width: 44, height: 44 },
      },
      {
        type: "Cell",
        label: "APP",
        hittable: false,
        rect: { x: 40, y: 360, width: 700, height: 28 },
      },
      {
        type: "Cell",
        label: "Appearance",
        hittable: false,
        rect: { x: 40, y: 400, width: 700, height: 44 },
      },
      {
        type: "StaticText",
        label: "Appearance",
        hittable: false,
        rect: { x: 80, y: 410, width: 120, height: 20 },
      },
      {
        type: "Cell",
        label: "Haptics",
        hittable: false,
        rect: { x: 40, y: 444, width: 700, height: 44 },
      },
      {
        type: "Cell",
        label: "App Language, English",
        hittable: false,
        rect: { x: 40, y: 580, width: 700, height: 44 },
      },
      {
        type: "Cell",
        label: "Profile picture, Bernardo Ferrari,  bferrari@ext.teachx.ai",
        hittable: false,
        rect: { x: 40, y: 200, width: 700, height: 80 },
      },
      {
        type: "SearchField",
        label: "Search settings",
        hittable: false,
        rect: { x: 500, y: 70, width: 200, height: 36 },
      },
    ],
    { excludeLanguageRows: true },
  );
  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Appearance", "Haptics"],
  );
});

test("translated settings rows still become tour stops", () => {
  const stops = extractTourStops([
    {
      type: "Cell",
      label: "Aparência",
      hittable: false,
      rect: { x: 40, y: 400, width: 700, height: 44 },
    },
    {
      type: "Cell",
      label: "Notificações",
      hittable: false,
      rect: { x: 40, y: 444, width: 700, height: 44 },
    },
  ]);
  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Aparência", "Notificações"],
  );
});

test("Compose TextViews inherit their hittable row and suppress row subtitles", () => {
  const stops = extractTourStops([
    {
      index: 1,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 1127, width: 990, height: 203 },
    },
    {
      index: 2,
      parentIndex: 1,
      type: "android.widget.TextView",
      label: "Appearance",
      rect: { x: 203, y: 1172, width: 242, height: 53 },
    },
    {
      index: 3,
      parentIndex: 1,
      type: "android.widget.TextView",
      label: "Dark",
      rect: { x: 203, y: 1236, width: 83, height: 49 },
    },
    {
      index: 4,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 1336, width: 990, height: 158 },
    },
    {
      index: 5,
      parentIndex: 4,
      type: "android.widget.TextView",
      label: "Haptics",
      rect: { x: 203, y: 1389, width: 155, height: 53 },
    },
  ]);

  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Appearance", "Haptics"],
  );
  assert.deepEqual(stops[0]?.point, { x: 540, y: 1228.5 });
});

test("a tappable Voice row is not mistaken for a Voice section heading", () => {
  const stops = extractTourStops([
    {
      index: 1,
      type: "android.widget.TextView",
      label: "Voice",
      rect: { x: 90, y: 804, width: 102, height: 49 },
    },
    {
      index: 2,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 922, width: 990, height: 158 },
    },
    {
      index: 3,
      parentIndex: 2,
      type: "android.widget.TextView",
      label: "Voice",
      rect: { x: 203, y: 943, width: 110, height: 53 },
    },
  ]);

  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Voice"],
  );
  assert.deepEqual(stops[0]?.point, { x: 540, y: 1001 });
});

test("a Compose row without parent indexes keeps its title over the selected value", () => {
  const stops = extractTourStops([
    {
      type: "android.widget.TextView",
      label: "Voice",
      rect: { x: 90, y: 804, width: 102, height: 49 },
    },
    {
      index: 2,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 922, width: 990, height: 158 },
    },
    {
      type: "android.widget.TextView",
      label: "Voice",
      rect: { x: 203, y: 943, width: 110, height: 53 },
    },
    {
      type: "android.widget.TextView",
      label: "Ara",
      rect: { x: 203, y: 1007, width: 60, height: 49 },
    },
  ]);

  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Voice"],
  );
  assert.deepEqual(stops[0]?.point, { x: 540, y: 1001 });
});

test("localized Compose section containers do not shift card landmarks", () => {
  const stops = extractTourStops([
    {
      index: 1,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 760, width: 990, height: 900 },
    },
    {
      index: 2,
      parentIndex: 1,
      type: "android.widget.TextView",
      label: "Voce",
      rect: { x: 136, y: 872, width: 110, height: 49 },
    },
    {
      index: 3,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 940, width: 990, height: 158 },
    },
    {
      index: 4,
      parentIndex: 3,
      type: "android.widget.TextView",
      label: "Voce",
      rect: { x: 203, y: 964, width: 110, height: 53 },
    },
    {
      index: 5,
      parentIndex: 3,
      type: "android.widget.TextView",
      label: "Ara",
      rect: { x: 203, y: 1028, width: 60, height: 49 },
    },
    {
      index: 6,
      parentIndex: 1,
      type: "android.widget.TextView",
      label: "Dati e informazioni",
      rect: { x: 136, y: 1214, width: 260, height: 49 },
    },
    {
      index: 7,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 1330, width: 990, height: 158 },
    },
    {
      index: 8,
      parentIndex: 7,
      type: "android.widget.TextView",
      label: "Conversazioni condivise",
      rect: { x: 203, y: 1354, width: 360, height: 53 },
    },
  ]);

  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Voce", "Conversazioni condivise"],
  );
  assert.deepEqual(stops[0]?.point, { x: 540, y: 1019 });
});

test("Compose list labels remain available when unrelated chrome is the only hittable cell", () => {
  const stops = extractTourStops([
    {
      index: 1,
      type: "android.widget.Button",
      label: "Close",
      hittable: true,
      rect: { x: 40, y: 70, width: 80, height: 48 },
    },
    {
      index: 2,
      type: "android.widget.TextView",
      label: "Kids Mode",
      rect: { x: 180, y: 460, width: 220, height: 53 },
    },
    {
      index: 3,
      type: "android.widget.TextView",
      label: "Data Controls",
      rect: { x: 180, y: 1428, width: 280, height: 53 },
    },
  ]);
  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Kids Mode", "Data Controls"],
  );
});

test("dynamic Compose subtitles do not become extra localized tour rows", () => {
  const stops = extractTourStops([
    {
      type: "android.widget.TextView",
      label: "Utilizzo",
      rect: { x: 203, y: 900, width: 150, height: 53 },
    },
    {
      type: "android.widget.TextView",
      label: "Ripristino disponibile",
      rect: { x: 203, y: 962, width: 240, height: 49 },
    },
    {
      type: "android.widget.TextView",
      label: "Aspetto",
      rect: { x: 203, y: 1240, width: 150, height: 53 },
    },
    {
      type: "android.widget.TextView",
      label: "Scuro",
      rect: { x: 203, y: 1302, width: 100, height: 49 },
    },
  ]);

  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Utilizzo", "Aspetto"],
  );
});

test("Compose headers and clipped rows below Android navigation are not tour stops", () => {
  const stops = extractTourStops([
    {
      index: 1,
      type: "android.view.View",
      hittable: true,
      rect: { x: 0, y: 300, width: 700, height: 1800 },
    },
    {
      index: 2,
      parentIndex: 1,
      type: "android.widget.TextView",
      label: "App",
      rect: { x: 48, y: 980, width: 60, height: 40 },
    },
    {
      index: 3,
      parentIndex: 1,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 1060, width: 610, height: 150 },
    },
    {
      index: 4,
      parentIndex: 3,
      type: "android.widget.TextView",
      label: "Appearance",
      rect: { x: 180, y: 1100, width: 180, height: 48 },
    },
    {
      index: 5,
      parentIndex: 1,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 2100, width: 610, height: 150 },
    },
    {
      index: 6,
      parentIndex: 5,
      type: "android.widget.TextView",
      label: "Customize Grok",
      rect: { x: 180, y: 2140, width: 180, height: 48 },
    },
    {
      identifier: "com.android.systemui:id/navigation_bar_frame",
      rect: { x: 0, y: 2200, width: 700, height: 120 },
    },
  ]);
  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Appearance"],
  );
});

test("Compose rows hidden underneath a fixed app bar cannot become tour stops", () => {
  const stops = extractTourStops([
    {
      index: 1,
      type: "android.widget.ImageView",
      label: "Close",
      hittable: true,
      rect: { x: 45, y: 159, width: 68, height: 68 },
    },
    {
      index: 2,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 97, width: 990, height: 158 },
    },
    {
      index: 3,
      parentIndex: 2,
      type: "android.widget.TextView",
      label: "Skills",
      rect: { x: 203, y: 150, width: 99, height: 13 },
    },
    {
      index: 4,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 261, width: 990, height: 158 },
    },
    {
      index: 5,
      parentIndex: 4,
      type: "android.widget.TextView",
      label: "Memory",
      rect: { x: 203, y: 314, width: 166, height: 53 },
    },
    { type: "android.view.View", rect: { x: 0, y: 0, width: 1080, height: 2340 } },
  ]);

  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Memory"],
  );
});

test("translated app bars and system chrome do not become localized tour rows", () => {
  const stops = extractTourStops([
    {
      identifier: "com.android.systemui:id/clock",
      bundleId: "com.android.systemui",
      type: "android.widget.TextView",
      label: "16:51",
      rect: { x: 55, y: 19, width: 96, height: 72 },
    },
    {
      index: 1,
      type: "android.view.View",
      hittable: true,
      rect: { x: 11, y: 125, width: 135, height: 135 },
    },
    {
      index: 2,
      parentIndex: 1,
      type: "android.widget.TextView",
      label: "Chiudi",
      rect: { x: 45, y: 159, width: 68, height: 68 },
    },
    {
      type: "android.widget.TextView",
      label: "Impostazioni",
      rect: { x: 157, y: 163, width: 291, height: 60 },
    },
    {
      index: 3,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 328, width: 990, height: 158 },
    },
    {
      index: 4,
      parentIndex: 3,
      type: "android.widget.TextView",
      label: "Utilizzo",
      rect: { x: 203, y: 380, width: 144, height: 53 },
    },
    { type: "android.view.View", rect: { x: 0, y: 0, width: 1080, height: 2340 } },
  ]);

  assert.deepEqual(
    stops.map((stop) => stop.label),
    ["Utilizzo"],
  );
});

test("tour origin uses child rows, not a shared nav title", () => {
  const settings = [
    {
      type: "NavigationBar",
      identifier: "Settings",
      rect: { x: 0, y: 50, width: 700, height: 50 },
    },
    {
      type: "Cell",
      label: "Appearance",
      hittable: false,
      rect: { x: 40, y: 400, width: 700, height: 44 },
    },
    {
      type: "Cell",
      label: "Haptics",
      hittable: false,
      rect: { x: 40, y: 444, width: 700, height: 44 },
    },
  ];
  const appearance = [
    {
      type: "NavigationBar",
      identifier: "Settings",
      rect: { x: 0, y: 50, width: 700, height: 50 },
    },
    {
      type: "Cell",
      label: "Dark",
      hittable: false,
      rect: { x: 40, y: 400, width: 700, height: 44 },
    },
    {
      type: "Button",
      label: "Back",
      hittable: true,
      rect: { x: 20, y: 70, width: 60, height: 36 },
    },
  ];
  const origin = tourScreenSignature(settings);
  assert.equal(sameTourScreen(origin, tourScreenSignature(settings)), true);
  assert.equal(sameTourScreen(origin, tourScreenSignature(appearance)), false);
  assert.equal(
    sameTourScreen(origin, tourScreenSignature([...settings, ...appearance.slice(1)])),
    true,
  );
});

test("mapped “Open Appearance” overlaps a live Appearance cell", () => {
  assert.equal(
    tourFallbackOverlap(
      [{ label: "Appearance" }, { label: "Haptics" }],
      [{ label: "Open Appearance" }, { label: "Haptics" }],
    ),
    2,
  );
});

test("tour origin prefers fingerprint over a shared Settings header", () => {
  assert.equal(
    onTourOrigin({
      liveFingerprint: "a".repeat(64),
      originFingerprint: "a".repeat(64),
      stops: [{ label: "Dark" }],
      fallbackStops: [{ label: "Appearance" }, { label: "Haptics" }],
    }),
    true,
  );
  assert.equal(
    onTourOrigin({
      liveFingerprint: "b".repeat(64),
      originFingerprint: "a".repeat(64),
      stops: [{ label: "Shortcuts" }, { label: "Automations" }],
      fallbackStops: [{ label: "Appearance" }, { label: "Haptics" }],
    }),
    false,
  );
});

test("tour origin does not confuse adjacent scroll positions with two shared rows", () => {
  assert.equal(
    onTourOrigin({
      liveFingerprint: "upper".repeat(16),
      originFingerprint: "lower".repeat(16),
      stops: [
        { label: "Customize Grok" },
        { label: "Connectors" },
        { label: "Skills" },
        { label: "Memory" },
      ],
      fallbackStops: [
        { label: "Skills" },
        { label: "Memory" },
        { label: "NSFW Preferences" },
        { label: "Voice" },
        { label: "Data Controls" },
        { label: "Shared Conversations" },
        { label: "Voice library" },
      ],
    }),
    false,
  );
});

test("localized exact tours may use one stable mapped landmark", () => {
  assert.equal(
    onTourOrigin({
      stops: [{ label: "SuperGrok" }, { label: "الاستخدام" }],
      fallbackStops: [{ label: "SuperGrok" }, { label: "Usage" }],
      minimumFallbackOverlap: 1,
    }),
    true,
  );
});
