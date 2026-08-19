import assert from "node:assert/strict";
import test from "node:test";
import { positionsAfterCanvasEdit, resolveCoincidentPositions } from "./app-map-destack";
import {
  CARD_PITCH_Y,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  SCREEN_FRAME_TOP,
  screenLabelBounds,
} from "./app-map-screen-layout";

test("leaves a map with no stacked cards exactly as its author arranged it", () => {
  // Deliberately tight, deliberately off-grid, deliberately not a tidy tree.
  const positions = {
    a: { x: 0, y: 0 },
    b: { x: 40, y: 12 },
    c: { x: -317, y: 205 },
  };

  assert.equal(resolveCoincidentPositions(positions), positions);
});

test("frees a screen hidden underneath another and clears the card it left", () => {
  const positions = {
    ara: { x: 80, y: 1360 },
    settings: { x: 80, y: 1360 },
  };

  const resolved = resolveCoincidentPositions(positions);

  const [first, second] = Object.values(resolved);
  assert.ok(
    Math.abs(first!.x - second!.x) >= SCREEN_CARD_WIDTH ||
      Math.abs(first!.y - second!.y) >= SCREEN_CARD_HEIGHT,
    "a freed screen still covered the card it was stacked on",
  );
  // One of the pair keeps the spot the document gave it: a repair moves as
  // little as it can, so the map a person remembers is still the map they see.
  assert.ok(Object.values(resolved).some((point) => point.x === 80 && point.y === 1360));
});

test("resolves a stack of three into three separate cards, deterministically", () => {
  const positions = {
    third: { x: 300, y: 300 },
    first: { x: 300, y: 300 },
    second: { x: 300, y: 300 },
  };

  const resolved = resolveCoincidentPositions(positions);
  const points = Object.values(resolved);

  for (const point of points) {
    for (const other of points) {
      if (point === other) continue;
      assert.ok(
        Math.abs(point.x - other.x) >= SCREEN_CARD_WIDTH ||
          Math.abs(point.y - other.y) >= SCREEN_CARD_HEIGHT,
        "two of three unstacked cards still overlap",
      );
    }
  }
  assert.deepEqual(resolveCoincidentPositions(positions), resolved);
});

test("does not shove a stacked pair through the cards around it", () => {
  // A stack in the middle of an otherwise full lattice: the freed card has to
  // walk out to real space rather than land on the first neighbour it finds.
  const positions: Record<string, { x: number; y: number }> = {};
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      positions[`grid-${column}-${row}`] = { x: column * 352, y: row * 288 };
    }
  }
  positions.stacked = { x: 352, y: 288 };

  const resolved = resolveCoincidentPositions(positions);
  const freed = resolved.stacked!;

  for (const [id, point] of Object.entries(resolved)) {
    if (id === "stacked") continue;
    assert.ok(
      Math.abs(freed.x - point.x) >= SCREEN_CARD_WIDTH ||
        Math.abs(freed.y - point.y) >= SCREEN_CARD_HEIGHT,
      `freed card landed on ${id}`,
    );
  }
});

test("a freed card clears the name band as well as the card it was under", () => {
  // The row below the stack is already occupied, so stepping straight down would
  // put the freed screen's name across that row's frame. It has to step aside.
  const positions = {
    ara: { x: 80, y: 1360 },
    settings: { x: 80, y: 1360 },
    below: { x: 80, y: 1360 + CARD_PITCH_Y },
  };

  const resolved = resolveCoincidentPositions(positions);
  const points = Object.values(resolved);

  for (const point of points) {
    for (const other of points) {
      if (point === other) continue;
      const band = screenLabelBounds(point);
      const framedOther =
        band.left < other.x + SCREEN_CARD_WIDTH &&
        other.x < band.right &&
        band.top < other.y + SCREEN_CARD_HEIGHT &&
        other.y + SCREEN_FRAME_TOP < band.bottom;
      assert.ok(!framedOther, "a freed card put its name inside another screen's frame");
    }
  }
});

test("the first edit commits the repair so a freed card cannot snap back", () => {
  const saved = { ara: { x: 80, y: 1360 }, settings: { x: 80, y: 1360 } };
  const shown = resolveCoincidentPositions(saved);

  // Somebody drags the screen that kept its spot. Without the repair the write
  // would leave its partner at the point it was hidden at, and the partner would
  // jump there the moment the pair stopped being coincident.
  const written = positionsAfterCanvasEdit(shown, { ara: { x: 900, y: 500 } });

  assert.deepEqual(written.settings, shown.settings);
  assert.deepEqual(written.ara, { x: 900, y: 500 });
  assert.deepEqual(resolveCoincidentPositions(written), written);
});

test("the first edit commits the journey so the rest of a crawl cannot snap back", () => {
  // What the canvas draws for a crawl nobody has arranged: the tidy layout, not
  // the filing lattice the document still holds.
  const shown = { settings: { x: 0, y: 0 }, appearance: { x: 352, y: 0 } };

  const written = positionsAfterCanvasEdit(shown, { appearance: { x: 700, y: 300 } });

  assert.deepEqual(written.settings, shown.settings);
  assert.deepEqual(written.appearance, { x: 700, y: 300 });
});
