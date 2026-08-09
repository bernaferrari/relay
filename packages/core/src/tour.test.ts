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
