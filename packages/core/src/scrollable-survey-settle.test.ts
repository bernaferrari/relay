import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";
import {
  surveyFeatureLabelsSettled,
  surveyPaywallFirstFrame,
  surveyPaywallFirstFrameMessage,
  surveyPaywallFrameDecision,
  surveyPlansForFeatureLabels,
  surveySelectedPaywallPlan,
} from "./scrollable-survey-settle.js";
import { surveyPixelsSettled } from "./scrollable-survey-seams.js";

function paywallSnapshot(input: {
  selected: "Lite" | "SuperGrok" | "Plus" | "Heavy";
  features: Array<{ label: string; y: number; height?: number }>;
  selectedFlag?: boolean;
}): SnapshotPayload {
  const tabs = [
    { label: "Lite" as const, x: 189 },
    { label: "SuperGrok" as const, x: 338 },
    { label: "Plus" as const, x: 620 },
    { label: "Heavy" as const, x: 776 },
  ];
  const nodes: SnapshotNode[] = [
    { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
  ];
  for (const tab of tabs) {
    if (tab.label !== input.selected) {
      nodes.push({
        type: "View",
        hittable: true,
        rect: { x: tab.x - 20, y: 462, width: 140, height: 135 },
      });
    }
    nodes.push({
      type: "TextView",
      label: tab.label,
      ...(input.selectedFlag && tab.label === input.selected ? { selected: true } : {}),
      rect: { x: tab.x, y: 505, width: 100, height: 49 },
    });
  }
  nodes.push({
    type: "TextView",
    label: "SuperGrok",
    rect: { x: 113, y: 708, width: 289, height: 70 },
  });
  if (input.selected !== "SuperGrok") {
    nodes.push({
      type: "TextView",
      label: input.selected,
      rect: { x: 419, y: 708, width: 158, height: 70 },
    });
  }
  nodes.push({
    type: "TextView",
    label: `Upgrade to ${input.selected}`,
    rect: { x: 354, y: 1162, width: 373, height: 53 },
  });
  for (const feature of input.features) {
    nodes.push({
      type: "TextView",
      label: feature.label,
      rect: { x: 203, y: feature.y, width: 600, height: feature.height ?? 60 },
    });
  }
  nodes.push({
    type: "TextView",
    label: "Terms | Privacy Policy",
    rect: { x: 46, y: 2137, width: 988, height: 45 },
  });
  return {
    capturedAt: 1,
    inspectable: true,
    source: "sdk",
    interactive: [],
    bounds: { width: 1080, height: 2340 },
    screenIdentity: { fingerprint: "paywall", nodes: [], volatileSignals: [] },
    nodes,
  };
}

function paint(value: number): Buffer {
  const png = new PNG({ width: 64, height: 160 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = value;
    png.data[offset + 1] = Math.max(0, value - 12);
    png.data[offset + 2] = Math.min(255, value + 20);
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

test("selects the plan tab that is not wrapped in a hittable chip", () => {
  assert.equal(
    surveySelectedPaywallPlan(paywallSnapshot({ selected: "Heavy", features: [] })),
    "Heavy",
  );
  assert.equal(
    surveySelectedPaywallPlan(paywallSnapshot({ selected: "Plus", features: [] })),
    "Plus",
  );
  assert.equal(
    surveySelectedPaywallPlan(paywallSnapshot({ selected: "Lite", features: [] })),
    "Lite",
  );
  assert.equal(
    surveySelectedPaywallPlan(paywallSnapshot({ selected: "SuperGrok", features: [] })),
    "SuperGrok",
  );
});

test("rejects a tree that mixes Plus and Heavy feature rows", () => {
  const mixed = paywallSnapshot({
    selected: "Heavy",
    features: [
      { label: "Everything in SuperGrok Plus", y: 1248 },
      { label: "Lightning-fast replies", y: 1359 },
      { label: "Chat, Imagine, Voice & Build", y: 1470 },
      { label: "Highest usage at the fastest speed", y: 1581 },
    ],
  });
  const verdict = surveyPaywallFirstFrame(mixed);
  assert.equal(verdict.kind, "mixed-plans");
  if (verdict.kind === "mixed-plans") assert.deepEqual(verdict.plans, ["Plus", "Heavy"]);
  assert.deepEqual(surveyPaywallFrameDecision(mixed), { kind: "reject", reason: "mixed-plan" });
  assert.match(surveyPaywallFirstFrameMessage(verdict), /mixes Plus and Heavy/u);
});

test("rejects Plus feature labels on a Heavy card", () => {
  const stale = paywallSnapshot({
    selected: "Heavy",
    selectedFlag: true,
    features: [
      { label: "Everything in SuperGrok", y: 1329 },
      { label: "Create 1080p videos", y: 1440 },
      { label: "Lightning-fast replies", y: 1719 },
      { label: "Priority access at peak times", y: 1830 },
    ],
  });
  const verdict = surveyPaywallFirstFrame(stale);
  assert.equal(verdict.kind, "plan-mismatch");
  if (verdict.kind === "plan-mismatch") {
    assert.equal(verdict.selected, "Heavy");
    assert.equal(verdict.featurePlan, "Plus");
  }
  assert.deepEqual(surveyPaywallFrameDecision(stale), { kind: "reject", reason: "wrong-plan" });
});

test("accepts a settled Heavy card whose rows match the selected tab", () => {
  const heavy = paywallSnapshot({
    selected: "Heavy",
    features: [
      { label: "Everything in SuperGrok Plus", y: 1248 },
      { label: "Highest usage at the fastest speed", y: 1359 },
      { label: "Solve extremely hard problems", y: 1470 },
      { label: "Access to Grok Bot", y: 1914 },
    ],
  });
  assert.deepEqual(surveyPaywallFirstFrame(heavy), { kind: "ok", plan: "Heavy" });
  assert.deepEqual(surveyPaywallFrameDecision(heavy), { kind: "accept" });
});

test("treats Arabic Lite rows plus Latin SuperGrok copy as a mixed card", () => {
  const mixed = paywallSnapshot({
    selected: "Lite",
    features: [
      { label: "تقدر تستخدم Grok Build", y: 1405, height: 80 },
      { label: "حدود أعلى بنفس السرعة العادية", y: 2117, height: 4 },
      { label: "More powerful coding tools", y: 1667 },
      { label: "Faster replies", y: 1798 },
    ],
  });
  assert.equal(surveyPaywallFirstFrame(mixed).kind, "mixed-plans");
});

test("does not invent a plan rejection from unclassified localized copy", () => {
  const unknown: SnapshotPayload = {
    capturedAt: 1,
    inspectable: true,
    source: "sdk",
    interactive: [],
    bounds: { width: 1080, height: 2340 },
    screenIdentity: { fingerprint: "settings", nodes: [], volatileSignals: [] },
    nodes: [
      { type: "ScrollView", rect: { x: 51, y: 0, width: 978, height: 2137 } },
      { label: "حساب", rect: { x: 80, y: 900, width: 800, height: 60 } },
      { label: "الإشعارات", rect: { x: 80, y: 1100, width: 800, height: 60 } },
    ],
  };
  assert.deepEqual(surveyPaywallFrameDecision(unknown), { kind: "accept" });
});

test("does not classify shared Grok Bot copy as a second plan", () => {
  assert.deepEqual(
    surveyPlansForFeatureLabels(["Access to Grok Bot", "Everything in SuperGrok Plus"]),
    ["Heavy"],
  );
});

test("feature labels are settled only when the same rows remain", () => {
  const first = paywallSnapshot({
    selected: "Plus",
    features: [{ label: "Lightning-fast replies", y: 1719 }],
  });
  const same = paywallSnapshot({
    selected: "Plus",
    features: [{ label: "Lightning-fast replies", y: 1600 }],
  });
  const next = paywallSnapshot({
    selected: "Heavy",
    features: [{ label: "Highest usage at the fastest speed", y: 1359 }],
  });
  assert.equal(surveyFeatureLabelsSettled(first, same), true);
  assert.equal(surveyFeatureLabelsSettled(first, next), false);
});

test("pixels are settled only when the card raster stops changing", () => {
  const quiet = paint(18);
  assert.equal(surveyPixelsSettled(quiet, paint(18)), true);
  assert.equal(surveyPixelsSettled(quiet, paint(92)), false);
});
