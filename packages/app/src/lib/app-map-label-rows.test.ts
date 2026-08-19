import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LABEL_ROW_PITCH, screenLabelRows } from "./app-map-label-rows";
import {
  MAX_LABEL_COUNTER_SCALE,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  SCREEN_FRAME_TOP,
  screenLabelBounds,
} from "./app-map-screen-layout";

describe("screenLabelRows", () => {
  it("leaves a normally laid out map completely alone", () => {
    const rows = screenLabelRows([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 320, y: 0 },
      { id: "c", x: 0, y: 400 },
    ]);
    assert.deepEqual(rows, {});
  });

  it("lifts the name of a screen saved almost on top of another", () => {
    const rows = screenLabelRows([
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 104, y: 103 },
    ]);
    assert.equal(rows.a, undefined, "the first screen keeps the usual place");
    assert.equal(rows.b, 1);
  });

  it("keeps lifting while a row is still taken", () => {
    const rows = screenLabelRows([
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 101, y: 100 },
      { id: "c", x: 102, y: 100 },
    ]);
    assert.deepEqual([rows.a, rows.b, rows.c], [undefined, 1, 2]);
  });

  it("stops lifting rather than hiding a name behind the cards above", () => {
    const stack = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      x: 100,
      y: 100,
    }));
    const rows = screenLabelRows(stack);
    assert.ok(Object.values(rows).every((row) => row <= 3));
  });

  it("resolves the same way regardless of the order it is given", () => {
    const nodes = [
      { id: "b", x: 104, y: 103 },
      { id: "a", x: 100, y: 100 },
    ];
    assert.deepEqual(screenLabelRows(nodes), screenLabelRows([...nodes].reverse()));
  });

  it("lifts a name past the frame above it instead of into it", () => {
    // Two screens dropped almost on top of each other with a third card close
    // above them. The single-row lift that would normally separate the pair
    // lands inside that card, so the name climbs to the first row of free air.
    const nodes = [
      { id: "above", x: 100, y: 0 },
      { id: "a", x: 100, y: 200 },
      { id: "b", x: 104, y: 203 },
    ];
    const rows = screenLabelRows(nodes);
    assert.equal(rows.above, undefined);
    assert.equal(rows.a, undefined);
    assert.equal(rows.b, 3);
    for (const node of nodes) {
      const band = screenLabelBounds(
        node,
        (rows[node.id] ?? 0) * LABEL_ROW_PITCH * MAX_LABEL_COUNTER_SCALE,
      );
      for (const other of nodes) {
        if (other.id === node.id || !rows[node.id]) continue;
        assert.ok(
          !(
            band.left < other.x + SCREEN_CARD_WIDTH &&
            other.x < band.right &&
            band.top < other.y + SCREEN_CARD_HEIGHT &&
            other.y + SCREEN_FRAME_TOP < band.bottom
          ),
          `the lifted name of ${node.id} paints inside the card of ${other.id}`,
        );
      }
    }
  });

  it("does not treat a normal horizontal neighbour as a collision", () => {
    assert.deepEqual(
      screenLabelRows([
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 240, y: 0 },
      ]),
      {},
    );
  });
});
