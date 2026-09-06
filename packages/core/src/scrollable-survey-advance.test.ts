import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";
import {
  surveyExtent,
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
      {
        label: "Back",
        identifier: "com.android.systemui:id/back",
        rect: { x: 100, y: 2205, width: 150, height: 135 },
      },
      {
        label: "Home",
        identifier: "com.android.systemui:id/home",
        rect: { x: 465, y: 2205, width: 150, height: 135 },
      },
      {
        label: "Recents",
        identifier: "com.android.systemui:id/recent_apps",
        rect: { x: 820, y: 2205, width: 150, height: 135 },
      },
      ...nodes,
    ],
  };
}

test("does not scroll a one-viewport Lite sheet that already shows its last feature", () => {
  const first = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
    { label: "Lite", rect: { x: 200, y: 530, width: 80, height: 40 } },
    { label: "Expert mode", rect: { x: 80, y: 1662, width: 800, height: 60 } },
    {
      label: "Increased limits at regular speed",
      rect: { x: 80, y: 1884, width: 800, height: 60 },
    },
    { label: "Terms | Privacy Policy", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.equal(surveyShouldAttemptScroll(first), false);
  assert.equal(surveyLastUnclippedFeature(first)?.label, "Increased limits at regular speed");
});

test("scrolls when the Android helper marks hidden content below", () => {
  const first = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Faster replies", rect: { x: 80, y: 2007, width: 800, height: 60 } },
    { label: "More powerful coding tools", rect: { x: 80, y: 2118, width: 800, height: 19 } },
    { label: "Terms | Privacy Policy", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.equal(surveyShouldAttemptScroll(first), true);
});

test("scrolls a nested Settings list when the inner scroller can still move", () => {
  const first = snapshot([
    { type: "ScrollView", identifier: "homepage", rect: { x: 0, y: 0, width: 1080, height: 2337 } },
    {
      type: "ScrollView",
      identifier: "main_content_scrollable_container",
      rect: { x: 0, y: 315, width: 1080, height: 2022 },
      hiddenContentBelow: true,
    },
    {
      type: "androidx.recyclerview.widget.RecyclerView",
      rect: { x: 0, y: 315, width: 1080, height: 2022 },
    },
    { label: "Network & internet", rect: { x: 80, y: 605, width: 800, height: 50 } },
    { label: "Wallpaper & style", rect: { x: 80, y: 2089, width: 800, height: 50 } },
    { label: "Colors, themed icons, app grid", rect: { x: 80, y: 2160, width: 800, height: 40 } },
  ]);
  assert.equal(surveyShouldAttemptScroll(first), true);
});

test("does not fling when hiddenContentBelow is a bounce hint and the last row is fully on screen", () => {
  const first = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Earliest access to new products", rect: { x: 80, y: 1884, width: 800, height: 60 } },
    { label: "Access to Grok Bot", rect: { x: 80, y: 1995, width: 800, height: 60 } },
    { label: "Terms | Privacy Policy", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.equal(surveyShouldAttemptScroll(first), false);
  assert.deepEqual(surveyExtent(first), {
    kind: "unknown",
    reason: "helper reports hidden content below the last visible label",
  });
});

test("does not declare complete when hidden content sits below a spaced last label", () => {
  const first = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Account", rect: { x: 80, y: 600, width: 800, height: 60 } },
    { label: "Notifications", rect: { x: 80, y: 1680, width: 800, height: 60 } },
  ]);
  assert.notEqual(surveyExtent(first).kind, "complete");
});

test("does not declare complete for a virtualized list of repeated labels", () => {
  const first = snapshot([
    {
      type: "androidx.recyclerview.widget.RecyclerView",
      rect: { x: 0, y: 200, width: 1080, height: 1900 },
      hiddenContentBelow: true,
    },
    { label: "Message", rect: { x: 80, y: 400, width: 800, height: 80 } },
    { label: "Message", rect: { x: 80, y: 1600, width: 800, height: 80 } },
  ]);
  assert.notEqual(surveyExtent(first).kind, "complete");
});

test("does not declare complete when only unlabeled images sit above hidden content", () => {
  const first = snapshot([
    {
      type: "ScrollView",
      rect: { x: 0, y: 0, width: 1080, height: 2137 },
      hiddenContentBelow: true,
    },
    { type: "ImageView", rect: { x: 40, y: 400, width: 1000, height: 700 } },
    { type: "ImageView", rect: { x: 40, y: 1200, width: 1000, height: 700 } },
  ]);
  assert.deepEqual(surveyExtent(first), {
    kind: "partial",
    reason: "helper reports hidden content below",
  });
});

test("does not declare complete for a nested scroller or a landscape last-label gap", () => {
  const nested = snapshot([
    { type: "ScrollView", identifier: "outer", rect: { x: 0, y: 0, width: 1080, height: 2337 } },
    {
      type: "ScrollView",
      identifier: "inner",
      rect: { x: 0, y: 315, width: 1080, height: 2022 },
      hiddenContentBelow: true,
    },
    { label: "Display", rect: { x: 80, y: 1800, width: 800, height: 50 } },
  ]);
  const landscape = snapshot(
    [
      {
        type: "ScrollView",
        rect: { x: 0, y: 0, width: 2340, height: 1080 },
        hiddenContentBelow: true,
      },
      { label: "Large type row", rect: { x: 80, y: 720, width: 1800, height: 80 } },
    ],
    1080,
  );
  assert.notEqual(surveyExtent(nested).kind, "complete");
  assert.notEqual(surveyExtent(landscape).kind, "complete");
});

test("declares complete only when the helper is exhausted and the last row is unclipped", () => {
  const first = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: false,
    },
    { label: "Lite", rect: { x: 200, y: 530, width: 80, height: 40 } },
    {
      label: "Increased limits at regular speed",
      rect: { x: 80, y: 1884, width: 800, height: 60 },
    },
    { label: "Terms | Privacy Policy", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.deepEqual(surveyExtent(first), {
    kind: "complete",
    evidence: "helper-exhausted-and-last-row-unclipped",
  });
});

test("does not treat a missing hiddenContentBelow hint as helper exhaustion", () => {
  const first = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
    { label: "Lite", rect: { x: 200, y: 530, width: 80, height: 40 } },
    {
      label: "Increased limits at regular speed",
      rect: { x: 80, y: 1884, width: 800, height: 60 },
    },
    { label: "Terms | Privacy Policy", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.notEqual(surveyExtent(first).kind, "complete");
  assert.equal(surveyExtent(first).kind, "unknown");
});

test("does not apply Grok paywall rules to an unrelated Lite/Plus pricing tree", () => {
  const first = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
    { label: "Lite", rect: { x: 180, y: 400, width: 80, height: 40 } },
    { label: "Plus", rect: { x: 300, y: 400, width: 80, height: 40 } },
    { label: "Monthly price", rect: { x: 80, y: 900, width: 800, height: 60 } },
  ]);
  const extent = surveyExtent(first);
  assert.notEqual(extent.kind, "complete");
  assert.equal(extent.kind, "unknown");
  if (extent.kind !== "unknown") throw new Error("expected unknown extent");
  assert.match(extent.reason, /did not report whether more content exists/u);
});

test("keeps a frame that unclips the faded last row or adds Grok Bot", () => {
  const clipped = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2121 },
      hiddenContentBelow: true,
    },
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
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Account", rect: { x: 80, y: 600, width: 800, height: 60 } },
    { label: "Privacy", rect: { x: 80, y: 800, width: 800, height: 60 } },
  ]);
  const after = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Account", rect: { x: 80, y: 459, width: 800, height: 60 } },
    { label: "Privacy", rect: { x: 80, y: 659, width: 800, height: 60 } },
  ]);
  assert.equal(surveyShouldKeepScrolledFrame(before, after), false);
  assert.equal(surveyHasHiddenContentBelow(after), true);
});

test("scrolls when the last feature sits under the sticky legal footer", () => {
  const first = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Plus", rect: { x: 620, y: 505, width: 77, height: 49 } },
    { label: "Early access to new features", rect: { x: 203, y: 1941, width: 602, height: 60 } },
    { label: "Access to Grok Bot", rect: { x: 203, y: 2052, width: 409, height: 60 } },
    { label: "Terms | Privacy Policy", rect: { x: 46, y: 2137, width: 988, height: 45 } },
  ]);
  assert.equal(surveyShouldAttemptScroll(first), true);
  assert.deepEqual(surveyExtent(first), {
    kind: "partial",
    reason: "last labeled row sits under the sticky legal footer",
  });
});

test("keeps a frame that lifts the last feature out from under the legal footer", () => {
  const covered = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Early access to new features", rect: { x: 203, y: 1941, width: 602, height: 60 } },
    { label: "Access to Grok Bot", rect: { x: 203, y: 2052, width: 409, height: 60 } },
    { label: "Terms | Privacy Policy", rect: { x: 46, y: 2137, width: 988, height: 45 } },
  ]);
  const cleared = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
    { label: "Early access to new features", rect: { x: 203, y: 1720, width: 602, height: 60 } },
    { label: "Access to Grok Bot", rect: { x: 203, y: 1831, width: 409, height: 60 } },
    { label: "Terms | Privacy Policy", rect: { x: 46, y: 2137, width: 988, height: 45 } },
  ]);
  assert.equal(surveyShouldKeepScrolledFrame(covered, cleared), true);
});

test("drops a title-slide that adds no labels and does not unclip a row", () => {
  const before = snapshot([
    {
      type: "ScrollView",
      rect: { x: 51, y: 0, width: 978, height: 2137 },
      hiddenContentBelow: true,
    },
    { label: "Uzman modu", rect: { x: 80, y: 1719, width: 800, height: 60 } },
    {
      label: "Standart hızda daha yüksek kullanım limitleri",
      rect: { x: 80, y: 1998, width: 800, height: 117 },
    },
    { label: "Şartlar | Gizlilik Politikası", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  const after = snapshot([
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
    { label: "Uzman modu", rect: { x: 80, y: 1578, width: 800, height: 60 } },
    {
      label: "Standart hızda daha yüksek kullanım limitleri",
      rect: { x: 80, y: 1857, width: 800, height: 117 },
    },
    { label: "Şartlar | Gizlilik Politikası", rect: { x: 300, y: 2137, width: 480, height: 45 } },
  ]);
  assert.equal(surveyShouldKeepScrolledFrame(before, after), false);
});

test("does not treat an unrelated sibling exhaustion hint as the selected scroller being complete", () => {
  const first = snapshot([
    {
      type: "ScrollView",
      identifier: "feed",
      rect: { x: 0, y: 0, width: 978, height: 1800 },
    },
    {
      type: "TextView",
      label: "Caption",
      rect: { x: 40, y: 1900, width: 200, height: 40 },
      hiddenContentBelow: false,
    },
    { label: "Latest post", rect: { x: 80, y: 1600, width: 800, height: 60 } },
  ]);
  assert.equal(surveyHasHiddenContentBelow(first), false);
  assert.notEqual(surveyExtent(first).kind, "complete");
  assert.equal(surveyExtent(first).kind, "unknown");
});
