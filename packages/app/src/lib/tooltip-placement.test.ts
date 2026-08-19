import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  TOOLTIP_GAP,
  TOOLTIP_MARGIN,
  tooltipLabelFor,
  tooltipPlacement,
} from "./tooltip-placement";

const viewport = { width: 1440, height: 900 };
const tooltip = { width: 120, height: 24 };

test("centres the tooltip under its anchor", () => {
  const placement = tooltipPlacement({
    anchor: { left: 700, top: 100, width: 40, height: 32 },
    tooltip,
    viewport,
  });
  assert.equal(placement.side, "bottom");
  assert.equal(placement.top, 100 + 32 + TOOLTIP_GAP);
  assert.equal(placement.left, 700 + 20 - 60);
});

test("a control at the right edge keeps its whole label on screen", () => {
  const placement = tooltipPlacement({
    anchor: { left: 1420, top: 12, width: 20, height: 28 },
    tooltip,
    viewport,
  });
  assert.equal(placement.left, viewport.width - tooltip.width - TOOLTIP_MARGIN);
  assert.ok(placement.left + tooltip.width <= viewport.width - TOOLTIP_MARGIN);
});

test("a control at the left edge is clamped rather than pushed negative", () => {
  const placement = tooltipPlacement({
    anchor: { left: 4, top: 12, width: 20, height: 28 },
    tooltip,
    viewport,
  });
  assert.equal(placement.left, TOOLTIP_MARGIN);
});

test("flips above only when there is no room below", () => {
  const anchor = { left: 700, top: 880, width: 40, height: 18 };
  const flipped = tooltipPlacement({ anchor, tooltip, viewport });
  assert.equal(flipped.side, "top");
  assert.ok(flipped.top < anchor.top);

  const roomy = tooltipPlacement({ anchor: { ...anchor, top: 400 }, tooltip, viewport });
  assert.equal(roomy.side, "bottom");
});

test("a cramped viewport still places the tooltip on screen", () => {
  const placement = tooltipPlacement({
    anchor: { left: 10, top: 4, width: 20, height: 20 },
    tooltip: { width: 300, height: 40 },
    viewport: { width: 320, height: 50 },
  });
  assert.ok(placement.top >= TOOLTIP_MARGIN);
  assert.ok(placement.left >= 0);
});

test("an icon-only control gets its tip, a labelled one that repeats it does not", () => {
  assert.equal(
    tooltipLabelFor({ tip: "Maps and runs", text: "", disabled: false }),
    "Maps and runs",
  );
  assert.equal(tooltipLabelFor({ tip: "Combine", text: "Combine", disabled: false }), null);
  assert.equal(
    tooltipLabelFor({ tip: "Rename map", text: "Grok Settings", disabled: false }),
    "Rename map",
  );
});

test("nothing is shown for a disabled control or an empty tip", () => {
  assert.equal(tooltipLabelFor({ tip: "Run this Test", text: "", disabled: true }), null);
  assert.equal(tooltipLabelFor({ tip: "   ", text: "", disabled: false }), null);
  assert.equal(tooltipLabelFor({ tip: null, text: "", disabled: false }), null);
});
