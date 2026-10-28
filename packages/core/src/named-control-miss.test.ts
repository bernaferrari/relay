import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device-capabilities.js";
import { resolveNamedControl, snapshotLabelMatches } from "./device-target-resolution.js";
import { namedControlMissHint } from "./named-control-miss.js";

const chip = (label: string): SnapshotNode => ({
  label,
  type: "android.widget.Button",
  hittable: true,
  rect: { x: 20, y: 500, width: 300, height: 60 },
});

test("ticking labels match by their stable stem", () => {
  assert.equal(snapshotLabelMatches("Thinking for 26s", "Thinking for 51s"), true);
  assert.equal(snapshotLabelMatches("Thought for", "Thought for 3s"), true);
  assert.equal(snapshotLabelMatches("Step 1", "Step 2"), false);
  assert.ok(resolveNamedControl([chip("Thinking for 51s")], { label: "Thinking for 26s" }));
});

test("a miss names visible near matches", () => {
  const hint = namedControlMissHint([chip("Continue with Google")], {
    label: "Continue with Apple",
  });
  assert.match(hint, /Visible near matches: "Continue with Google"/);
});

test("an app's Back wins over the system navigation Back", () => {
  const app: SnapshotNode = {
    ...chip("Back"),
    bundleId: "ai.x.grok",
    rect: { x: 0, y: 100, width: 120, height: 120 },
  };
  const nav: SnapshotNode = {
    ...chip("Back"),
    identifier: "com.android.systemui:id/back",
    bundleId: "com.android.systemui",
    rect: { x: 180, y: 2220, width: 120, height: 120 },
  };
  assert.deepEqual(resolveNamedControl([app, nav], { label: "Back" })?.point, { x: 60, y: 160 });
  assert.deepEqual(resolveNamedControl([nav], { label: "Back" })?.point, { x: 240, y: 2280 });
});
