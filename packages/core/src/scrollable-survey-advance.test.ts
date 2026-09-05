import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";
import {
  surveyHasHiddenContentBelow,
  surveyLastUnclippedFeature,
  surveyShouldAttemptScroll,
  surveyShouldKeepScrolledFrame,
  surveyStitchCutY,
} from "./scrollable-survey-advance.js";

function snapshot(nodes: SnapshotNode[], height = 2340): SnapshotPayload {
  return {
    capturedAt: 1,
    inspectable: true,
    source: "sdk",
    interactive: [],
    bounds: { width: 1080, height },
    screenIdentity: { fingerprint: "paywall", nodes: [], volatileSignals: [] },
    nodes: [
      {
        type: "FrameLayout",
        identifier: "com.android.systemui:id/navigation_bar_frame",
        rect: { x: 0, y: 2205, width: 1080, height: 135 },
      },
      { label: "Back", identifier: "com.android.systemui:id/back", rect: { x: 100, y: 2205, width: 150, height: 135 } },
      { label: "Home", identifier: "com.android.systemui:id/home", rect: { x: 465, y: 2205, width: 150, height: 135 } },
      { label: "Recents", identifier: "com.android.systemui:id/recent_apps", rect: { x: 820, y: 2205, width: 150, height: 135 } },
      ...nodes,
    ],
  };
}

test("does not scroll a one-viewport Lite sheet that already shows its last feature", () => {
  const first = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
    { label: "Lite", rect: { x: 200, y: 530, width: 80, height: 40 } },
    { label: "Expert mode", rect: { x: 80, y: 1662, width: 800, height: 60 } },
    { label: "Increased limits at regular speed", rect: { x: 80, y: 1884, width: 800, height: 60 } },
    { label: "Terms | Privacy Policy", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.equal(surveyShouldAttemptScroll(first), false);
  assert.equal(surveyLastUnclippedFeature(first)?.label, "Increased limits at regular speed");
});

test("scrolls when the Android helper marks hidden content below", () => {
  const first = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 }, hiddenContentBelow: true },
    { label: "Faster replies", rect: { x: 80, y: 2007, width: 800, height: 60 } },
    { label: "More powerful coding tools", rect: { x: 80, y: 2118, width: 800, height: 19 } },
    { label: "Terms | Privacy Policy", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.equal(surveyShouldAttemptScroll(first), true);
});

test("keeps a frame that unclips the faded last row or adds Grok Bot", () => {
  const clipped = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2121 }, hiddenContentBelow: true },
    { label: "X Premium+", rect: { x: 80, y: 1924, width: 800, height: 80 } },
    { label: "Early access", rect: { x: 80, y: 2055, width: 800, height: 66 } },
    { label: "الشروط | سياسة الخصوصية", rect: { x: 300, y: 2121, width: 480, height: 61 } },
  ]);
  const revealed = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2121 } },
    { label: "X Premium+", rect: { x: 80, y: 1616, width: 800, height: 80 } },
    { label: "Early access", rect: { x: 80, y: 1747, width: 800, height: 80 } },
    { label: "الوصول إلى Grok Bot", rect: { x: 80, y: 1878, width: 800, height: 80 } },
    { label: "الشروط | سياسة الخصوصية", rect: { x: 300, y: 2121, width: 480, height: 61 } },
  ]);
  assert.equal(surveyShouldKeepScrolledFrame(clipped, revealed), true);
  assert.equal(surveyStitchCutY(clipped, 2205), 2004);
});

test("does not treat a chrome-only slide as the end when the helper still reports more", () => {
  const before = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 }, hiddenContentBelow: true },
    { label: "Account", rect: { x: 80, y: 600, width: 800, height: 60 } },
    { label: "Privacy", rect: { x: 80, y: 800, width: 800, height: 60 } },
  ]);
  const after = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 }, hiddenContentBelow: true },
    { label: "Account", rect: { x: 80, y: 459, width: 800, height: 60 } },
    { label: "Privacy", rect: { x: 80, y: 659, width: 800, height: 60 } },
  ]);
  assert.equal(surveyShouldKeepScrolledFrame(before, after), false);
  assert.equal(surveyHasHiddenContentBelow(after), true);
});

test("drops a title-slide that adds no labels and does not unclip a row", () => {
  const before = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 }, hiddenContentBelow: true },
    { label: "Uzman modu", rect: { x: 80, y: 1719, width: 800, height: 60 } },
    { label: "Standart hızda daha yüksek kullanım limitleri", rect: { x: 80, y: 1998, width: 800, height: 117 } },
    { label: "Şartlar | Gizlilik Politikası", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  const after = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
    { label: "Uzman modu", rect: { x: 80, y: 1578, width: 800, height: 60 } },
    { label: "Standart hızda daha yüksek kullanım limitleri", rect: { x: 80, y: 1857, width: 800, height: 117 } },
    { label: "Şartlar | Gizlilik Politikası", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.equal(surveyShouldKeepScrolledFrame(before, after), false);
});
