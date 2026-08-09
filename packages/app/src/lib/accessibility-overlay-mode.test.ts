import assert from "node:assert/strict";
import test from "node:test";
import {
  accessibilityCollectionEnabled,
  accessibilityHoverEnabled,
  nextAccessibilityOverlayMode,
  parseAccessibilityOverlayMode,
} from "./accessibility-overlay-mode";

test("unknown saved accessibility modes fall back to hover inspection", () => {
  assert.equal(parseAccessibilityOverlayMode("legacy"), "hover");
  assert.equal(parseAccessibilityOverlayMode(null), "hover");
});

test("hidden keeps semantic data while off stops collection", () => {
  assert.equal(accessibilityCollectionEnabled("hidden"), true);
  assert.equal(accessibilityCollectionEnabled("off"), false);
  assert.equal(accessibilityHoverEnabled("hidden"), false);
});

test("the accessibility mode command cycles through every explicit state", () => {
  assert.equal(nextAccessibilityOverlayMode("always"), "hover");
  assert.equal(nextAccessibilityOverlayMode("hover"), "hidden");
  assert.equal(nextAccessibilityOverlayMode("hidden"), "off");
  assert.equal(nextAccessibilityOverlayMode("off"), "always");
});
