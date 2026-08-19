import assert from "node:assert/strict";
import test from "node:test";
import { crawlFilingSlot } from "@relay/protocol";
import { isUnarrangedCrawlFiling } from "./app-map-crawl-filing";
import { compactCanvasPositions } from "./app-map-auto-layout";

function filedCrawl(screens: number): Record<string, { x: number; y: number }> {
  return Object.fromEntries(
    Array.from({ length: screens }, (_, index) => [`screen-${index}`, crawlFilingSlot(index)]),
  );
}

test("recognises the geometry an accepted crawl files, at the size of the real map", () => {
  // default:grok-settings is 44 screens, every one of them still on the slot the
  // accept path gave it.
  assert.equal(isUnarrangedCrawlFiling(filedCrawl(44)), true);
});

test("one dragged screen makes the whole map an arrangement to preserve", () => {
  const filed = filedCrawl(44);

  assert.equal(
    isUnarrangedCrawlFiling({ ...filed, "screen-7": { x: 1_284, y: 612 } }),
    false,
    "a map somebody has started arranging must be left exactly as they left it",
  );
  // Even one grid nudge off the slot is somebody's decision.
  assert.equal(isUnarrangedCrawlFiling({ ...filed, "screen-7": { x: 100, y: 100 } }), false);
});

test("a map with nothing to arrange is not a crawl filing", () => {
  assert.equal(isUnarrangedCrawlFiling({}), false);
  assert.equal(isUnarrangedCrawlFiling({ only: crawlFilingSlot(0) }), false);
});

test("the tidy journey is never mistaken for the filing it replaces", () => {
  // Otherwise the canvas would discard its own layout on the next read and the
  // map would flicker between the two.
  const arranged = compactCanvasPositions({
    screens: ["settings", "appearance", "usage", "advanced"].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "appearance" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "usage" } },
      { fromScreenId: "usage", destination: { kind: "screen", screenId: "advanced" } },
    ],
  });

  assert.equal(isUnarrangedCrawlFiling(arranged), false);
});
