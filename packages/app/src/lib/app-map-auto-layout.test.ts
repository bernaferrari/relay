import assert from "node:assert/strict";
import test from "node:test";
import { compactCanvasPositions } from "./app-map-auto-layout";
import { DEFAULT_CANVAS_GRID_SPACING } from "./app-map-grid";
import {
  CARD_PITCH_X,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  SCREEN_FRAME_TOP,
  screenLabelBounds,
} from "./app-map-screen-layout";

/**
 * A map reads the way text does: down the rows, and left to right along one.
 *
 * A fan the layout packs side by side still has to arrive in the order it was
 * recorded, so "before" is the reading order rather than a smaller y. Order
 * tests use this so that packing a fan cannot quietly reorder it.
 */
function readsBefore(first?: { x: number; y: number }, second?: { x: number; y: number }): boolean {
  if (!first || !second) return false;
  return first.y < second.y || (first.y === second.y && first.x < second.x);
}

test("lays out every screen once and packs a wide fan of terminal screens", () => {
  const screens = Array.from({ length: 43 }, (_, index) => ({ id: `screen-${index}` }));
  const transitions = screens.slice(1).map((screen, index) => ({
    fromScreenId: index < 14 ? "screen-0" : `screen-${index}`,
    destination: { kind: "screen", screenId: screen.id },
  }));
  const positions = compactCanvasPositions({
    screens,
    flows: [{ screenId: "screen-0" }],
    transitions,
  });

  assert.equal(Object.keys(positions).length, screens.length);
  assert.equal(
    new Set(Object.values(positions).map(({ x, y }) => `${x}:${y}`)).size,
    screens.length,
  );
  assert.equal(positions["screen-0"]?.x, 0);
  // Thirteen of the fourteen branches open nothing else. One row each is what
  // turned this shape — the real Grok Settings hub — into a ribbon.
  const fan = Array.from({ length: 13 }, (_, index) => positions[`screen-${index + 1}`]!);
  assert.ok(
    new Set(fan.map(({ y }) => y)).size <= 4,
    "thirteen terminal screens must not spend thirteen rows",
  );
  assert.ok(
    new Set(fan.map(({ x }) => x)).size > 1,
    "a packed fan reads across columns, not down one",
  );
  assert.ok(
    fan.every(({ x, y }) => x > positions["screen-0"]!.x && y >= positions["screen-0"]!.y),
    "the fan stays inside its own band, past the screen that opens it",
  );
  const cards = Object.values(positions);
  for (let left = 0; left < cards.length; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      const a = cards[left]!;
      const b = cards[right]!;
      assert.ok(
        a.x + 240 <= b.x || b.x + 240 <= a.x || a.y + 230 <= b.y || b.y + 230 <= a.y,
        `cards ${left} and ${right} overlap`,
      );
    }
  }
});

test("wraps a wide fan of one-row branches in the order they were recorded", () => {
  // The real Grok Settings hub: rows that open a single screen you come back
  // from, mixed in with rows that open nothing at all.
  const fan = ["appearance", "memory", "haptics", "usage", "advanced", "widget", "skills"];
  const graph = {
    screens: ["settings", "import", "always-ask", ...fan].map((id) => ({
      id,
    })),
    flows: [{ screenId: "settings" }],
    transitions: [
      { id: "appearance", y: 0.1 },
      { id: "memory", y: 0.2 },
      { id: "haptics", y: 0.3 },
      { id: "usage", y: 0.4 },
      { id: "advanced", y: 0.5 },
      { id: "widget", y: 0.6 },
      { id: "skills", y: 0.7 },
    ].map((row) => ({
      fromScreenId: "settings",
      destination: { kind: "screen", screenId: row.id },
      sourceAnchor: { point: { x: 0.5, y: row.y } },
    })),
  };
  graph.transitions.push(
    {
      fromScreenId: "memory",
      destination: { kind: "screen", screenId: "import" },
      sourceAnchor: { point: { x: 0.5, y: 0.5 } },
    },
    {
      fromScreenId: "advanced",
      destination: { kind: "screen", screenId: "always-ask" },
      sourceAnchor: { point: { x: 0.5, y: 0.5 } },
    },
  );
  const positions = compactCanvasPositions(graph);

  assert.equal(
    positions.appearance?.y,
    positions.settings?.y,
    "the first branch of the fan keeps the hub's row",
  );
  // A one-row chain belongs on the shelf and keeps its own reach: its
  // continuation stays on its row, in the columns the shelf reserved for it.
  assert.equal(positions.memory?.y, positions.import?.y);
  assert.ok((positions.import?.x ?? 0) > (positions.memory?.x ?? 0));
  assert.equal(positions.advanced?.y, positions["always-ask"]?.y);
  assert.ok((positions["always-ask"]?.x ?? 0) > (positions.advanced?.x ?? 0));
  assert.equal(
    new Set(fan.map((id) => positions[id]!.y)).size,
    2,
    "seven one-row branches wrap into a block instead of seven rows",
  );
  for (let index = 1; index < fan.length; index += 1) {
    assert.ok(
      readsBefore(positions[fan[index - 1]!], positions[fan[index]!]),
      `${fan[index - 1]} should still be read before ${fan[index]}`,
    );
  }
  const cards = Object.values(positions);
  for (let left = 0; left < cards.length; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      const a = cards[left]!;
      const b = cards[right]!;
      assert.ok(
        a.x + SCREEN_CARD_WIDTH <= b.x ||
          b.x + SCREEN_CARD_WIDTH <= a.x ||
          a.y + SCREEN_CARD_HEIGHT <= b.y ||
          b.y + SCREEN_CARD_HEIGHT <= a.y,
        "a wrapped shelf must not overlap the chains it packs",
      );
    }
  }
  for (const [id, point] of Object.entries(positions)) {
    const band = screenLabelBounds(point);
    for (const [otherId, card] of Object.entries(positions)) {
      if (otherId === id) continue;
      assert.ok(
        !(
          band.left < card.x + SCREEN_CARD_WIDTH &&
          card.x < band.right &&
          band.top < card.y + SCREEN_CARD_HEIGHT &&
          card.y + SCREEN_FRAME_TOP < band.bottom
        ),
        `the name of ${id} paints inside the card of ${otherId}`,
      );
    }
  }
});

test("packs a small fan side by side rather than spending a row on each", () => {
  // Four screens that open nothing used to spend four rows, and a row costs
  // four times what a column does on a canvas twice as wide as it is tall. They
  // are packed into a block instead — wrapped to whichever width leaves the map
  // nearest that proportion — and the block is read in the recorded order.
  const ordered = ["appearance", "haptics", "usage", "widget"];
  const positions = compactCanvasPositions({
    screens: ["settings", ...ordered].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: ordered.map((id, index) => ({
      fromScreenId: "settings",
      destination: { kind: "screen", screenId: id },
      sourceAnchor: { point: { x: 0.5, y: (index + 1) / 5 } },
    })),
  });

  assert.ok(
    new Set(ordered.map((id) => positions[id]!.y)).size < ordered.length,
    "four screens that open nothing should not spend a row each",
  );
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      readsBefore(positions[ordered[index - 1]!], positions[ordered[index]!]),
      `${ordered[index - 1]} should still be read before ${ordered[index]}`,
    );
  }
});

test("packs a fan of two dead ends side by side", () => {
  const ordered = ["appearance", "haptics"];
  const positions = compactCanvasPositions({
    screens: ["settings", ...ordered].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: ordered.map((id, index) => ({
      fromScreenId: "settings",
      destination: { kind: "screen", screenId: id },
      sourceAnchor: { point: { x: 0.5, y: (index + 1) / 3 } },
    })),
  });

  assert.equal(positions.settings?.y, positions.appearance?.y);
  assert.equal(positions.appearance?.y, positions.haptics?.y);
  assert.ok(readsBefore(positions.appearance, positions.haptics));
});

test("leaves a fan of two continuing journeys a row each", () => {
  // Packing this pair would put both branches on the parent row, which is the
  // one row the branch optimizer has to give away. A pair only packs when one
  // of its sides opens nothing, so there was no promotion to lose.
  const positions = compactCanvasPositions({
    screens: ["settings", "usage", "usage-detail", "data-controls", "advanced"].map((id) => ({
      id,
    })),
    flows: [{ screenId: "settings" }],
    transitions: [
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "usage" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "data-controls" } },
      { fromScreenId: "usage", destination: { kind: "screen", screenId: "usage-detail" } },
      { fromScreenId: "data-controls", destination: { kind: "screen", screenId: "advanced" } },
    ],
  });

  assert.equal(positions.usage?.x, positions["data-controls"]?.x);
  assert.notEqual(positions.usage?.y, positions["data-controls"]?.y);
  assert.ok(readsBefore(positions.usage, positions["data-controls"]));
});

test("re-flows a shelf wider when the map is still taller than it is read", () => {
  // Four sections, each opening a fan of terminal screens. At a fixed seven
  // columns every fan wraps to two rows and the map ends up far taller than the
  // pane it is read in, while the columns a wider shelf needs are columns that
  // pane was giving away for free.
  const fanOf = (hub: string) => Array.from({ length: 9 }, (_, index) => `${hub}-${index}`);
  const hubs = ["appearance", "memory", "usage", "connectors"];
  const positions = compactCanvasPositions({
    screens: ["settings", ...hubs, ...hubs.flatMap(fanOf)].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      ...hubs.map((hub) => ({
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: hub },
      })),
      ...hubs.flatMap((hub) =>
        fanOf(hub).map((id) => ({
          fromScreenId: hub,
          destination: { kind: "screen", screenId: id },
        })),
      ),
    ],
  });

  for (const hub of hubs) {
    const fan = fanOf(hub).map((id) => positions[id]!);
    assert.equal(new Set(fan.map(({ y }) => y)).size, 1, `${hub} opens nine on one row`);
    for (let index = 1; index < fan.length; index += 1) {
      assert.ok(readsBefore(fan[index - 1], fan[index]), "a re-flowed shelf keeps its order");
    }
  }
});

test("wraps a shelf narrower rather than lay a small map out in a strip", () => {
  // A shelf wide enough to hold every screen makes a five-screen map a strip
  // seven cards long and one deep, which is width-bound: it now reads smaller
  // than the same five screens would three across.
  const ordered = ["display", "sound", "storage", "battery", "apps", "about"];
  const positions = compactCanvasPositions({
    screens: ["settings", ...ordered].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: ordered.map((id) => ({
      fromScreenId: "settings",
      destination: { kind: "screen", screenId: id },
    })),
  });

  const columns = new Set(ordered.map((id) => positions[id]!.x)).size;
  assert.ok(columns < ordered.length, `six terminal screens should not lie in one strip`);
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      readsBefore(positions[ordered[index - 1]!], positions[ordered[index]!]),
      "a narrowed shelf keeps its order",
    );
  }
});

test("reserves the name band above every card on a dense map", () => {
  // One hub with a wide fan-out, each branch continuing, is the shape of the
  // real Grok Settings map: it is where rows are packed tightest.
  const screens = Array.from({ length: 44 }, (_, index) => ({ id: `screen-${index}` }));
  const transitions = screens.slice(1).map((screen, index) => ({
    fromScreenId: index < 15 ? "screen-0" : `screen-${index - 14}`,
    destination: { kind: "screen", screenId: screen.id },
  }));
  const positions = compactCanvasPositions({
    screens,
    flows: [{ screenId: "screen-0" }],
    transitions,
  });

  for (const [id, label] of Object.entries(positions)) {
    const band = screenLabelBounds(label);
    for (const [otherId, card] of Object.entries(positions)) {
      if (otherId === id) continue;
      const overlapsFrame =
        band.left < card.x + SCREEN_CARD_WIDTH &&
        card.x < band.right &&
        band.top < card.y + SCREEN_CARD_HEIGHT &&
        card.y + SCREEN_FRAME_TOP < band.bottom;
      assert.ok(!overlapsFrame, `the name of ${id} paints inside the card of ${otherId}`);
    }
  }
});

test("wraps screens with no path into a band instead of extending the spine", () => {
  // The real Grok Settings crawl: one journey plus a drift of states it never
  // found a way out of. One row each turned a readable tree into a ribbon.
  const journey = ["settings", "appearance", "usage"].map((id) => ({ id }));
  const loose = Array.from({ length: 9 }, (_, index) => ({ id: `orphan-${index}` }));
  const positions = compactCanvasPositions({
    screens: [...journey, ...loose],
    flows: [{ screenId: "settings" }],
    transitions: [
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "appearance" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "usage" } },
    ],
  });

  const journeyBottom = Math.max(
    ...journey.map((screen) => positions[screen.id]!.y + SCREEN_CARD_HEIGHT),
  );
  const band = loose.map((screen) => positions[screen.id]!);
  for (const point of band) {
    assert.ok(point.y > journeyBottom, "a loose capture must sit below the journeys, not beside");
  }
  assert.ok(
    new Set(band.map((point) => point.x)).size >= 4,
    "loose captures wrap across columns rather than stacking in one",
  );
  assert.ok(
    new Set(band.map((point) => point.y)).size <= 3,
    "nine unconnected screens must not spend nine rows",
  );
  const cards = Object.values(positions);
  for (let left = 0; left < cards.length; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      const a = cards[left]!;
      const b = cards[right]!;
      assert.ok(
        a.x + SCREEN_CARD_WIDTH <= b.x ||
          b.x + SCREEN_CARD_WIDTH <= a.x ||
          a.y + SCREEN_CARD_HEIGHT <= b.y ||
          b.y + SCREEN_CARD_HEIGHT <= a.y,
        "the band overlaps the map",
      );
    }
  }
});

test("packs short side paths into one band under the journey", () => {
  // The rest of the real Grok Settings crawl: the journey, plus states it
  // reached again and left holding two screens each. Nothing opens them, so a
  // band of their own was a full map width spent on two cards.
  const journey = ["hub", "a", "b", "c", "d", "e", "f", "g"];
  const sides = ["side-a", "tail-a", "side-b", "tail-b"];
  const positions = compactCanvasPositions({
    screens: [...journey, ...sides].map((id) => ({ id })),
    flows: [{ screenId: "hub" }],
    transitions: [
      { fromScreenId: "hub", destination: { kind: "screen", screenId: "a" } },
      { fromScreenId: "a", destination: { kind: "screen", screenId: "b" } },
      { fromScreenId: "b", destination: { kind: "screen", screenId: "c" } },
      { fromScreenId: "c", destination: { kind: "screen", screenId: "d" } },
      { fromScreenId: "hub", destination: { kind: "screen", screenId: "e" } },
      { fromScreenId: "hub", destination: { kind: "screen", screenId: "f" } },
      { fromScreenId: "hub", destination: { kind: "screen", screenId: "g" } },
      { fromScreenId: "side-a", destination: { kind: "screen", screenId: "tail-a" } },
      { fromScreenId: "side-b", destination: { kind: "screen", screenId: "tail-b" } },
    ],
  });

  const journeyBottom = Math.max(...journey.map((id) => positions[id]!.y + SCREEN_CARD_HEIGHT));
  for (const id of sides) {
    assert.ok(positions[id]!.y > journeyBottom, "a side path belongs under the journey");
  }
  assert.equal(positions["side-a"]?.y, positions["side-b"]?.y, "both side paths share one band");
  assert.ok(
    positions["side-b"]!.x - positions["tail-a"]!.x > CARD_PITCH_X,
    "an empty column keeps the second path from reading as a continuation of the first",
  );
  assert.ok(
    Math.max(...sides.map((id) => positions[id]!.x)) <=
      Math.max(...journey.map((id) => positions[id]!.x)),
    "packing side paths must not make the map wider than its journey already is",
  );
  const cards = Object.values(positions);
  for (let left = 0; left < cards.length; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      const first = cards[left]!;
      const second = cards[right]!;
      assert.ok(
        first.x + SCREEN_CARD_WIDTH <= second.x ||
          second.x + SCREEN_CARD_WIDTH <= first.x ||
          first.y + SCREEN_CARD_HEIGHT <= second.y ||
          second.y + SCREEN_CARD_HEIGHT <= first.y,
        "a packed band overlaps the map",
      );
    }
  }
});

test("keeps an unconnected scroll chain whole rather than filing it as loose captures", () => {
  const positions = compactCanvasPositions({
    screens: ["settings", "settings-more", "stray"].map((id) => ({ id })),
    flows: [],
    transitions: [
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "settings-more" },
        label: "Scroll",
      },
    ],
  });

  assert.equal(positions.settings?.x, positions["settings-more"]?.x);
  assert.ok((positions["settings-more"]?.y ?? 0) > (positions.settings?.y ?? 0));
  assert.ok(
    (positions.stray?.y ?? 0) > (positions["settings-more"]?.y ?? 0),
    "the lone capture belongs under the chain, not inside it",
  );
});

test("auto-layout always places new cards on the fixed snap lattice", () => {
  const positions = compactCanvasPositions({
    screens: ["root", "left", "right"].map((id) => ({ id })),
    flows: [{ screenId: "root" }],
    transitions: [
      { fromScreenId: "root", destination: { kind: "screen", screenId: "left" } },
      { fromScreenId: "root", destination: { kind: "screen", screenId: "right" } },
    ],
  });

  for (const point of Object.values(positions)) {
    assert.equal(point.x % DEFAULT_CANVAS_GRID_SPACING, 0);
    assert.equal(point.y % DEFAULT_CANVAS_GRID_SPACING, 0);
  }
});

test("keeps viewport captures in one vertical block", () => {
  const graph = {
    screens: ["settings", "settings-more", "settings-about", "privacy"].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "settings-more" },
        label: "Scroll",
      },
      {
        fromScreenId: "settings-more",
        destination: { kind: "screen", screenId: "settings-about" },
        label: "Scroll to About",
      },
      {
        fromScreenId: "settings-about",
        destination: { kind: "screen", screenId: "privacy" },
        label: "Privacy policy",
      },
    ],
  };
  const positions = compactCanvasPositions(graph);

  assert.equal(positions.settings?.x, positions["settings-more"]?.x);
  assert.equal(positions.settings?.x, positions["settings-about"]?.x);
  assert.ok((positions["settings-more"]?.y ?? 0) > (positions.settings?.y ?? 0));
  assert.ok((positions["settings-about"]?.y ?? 0) > (positions["settings-more"]?.y ?? 0));
  assert.ok(
    (positions["settings-more"]?.y ?? 0) - (positions.settings?.y ?? 0) > 278,
    "scroll states should reserve extra routing space between previews",
  );
  assert.ok((positions.privacy?.x ?? 0) > (positions["settings-about"]?.x ?? 0));
});

test("aligns branches with the scroll state that opened them", () => {
  const graph = {
    screens: ["settings", "more", "about", "appearance", "memory", "legal"].map((id) => ({
      id,
    })),
    flows: [{ screenId: "settings" }],
    transitions: [
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "more" },
        label: "Scroll",
      },
      {
        fromScreenId: "more",
        destination: { kind: "screen", screenId: "about" },
        label: "Scroll",
      },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "appearance" } },
      { fromScreenId: "more", destination: { kind: "screen", screenId: "memory" } },
      { fromScreenId: "about", destination: { kind: "screen", screenId: "legal" } },
    ],
  };
  const positions = compactCanvasPositions(graph);

  assert.equal(positions.appearance?.y, positions.settings?.y);
  assert.equal(positions.memory?.y, positions.more?.y);
  assert.equal(positions.legal?.y, positions.about?.y);
});

test("places each viewport state after the previous state's complete branch block", () => {
  const graph = {
    screens: ["settings", "more", "appearance", "haptics", "widget", "memory", "skills"].map(
      (id) => ({ id }),
    ),
    flows: [{ screenId: "settings" }],
    transitions: [
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "more" },
        label: "Scroll",
      },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "appearance" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "haptics" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "widget" } },
      { fromScreenId: "more", destination: { kind: "screen", screenId: "memory" } },
      { fromScreenId: "more", destination: { kind: "screen", screenId: "skills" } },
    ],
  };
  const positions = compactCanvasPositions(graph);

  assert.equal(positions.settings?.y, positions.appearance?.y);
  assert.ok(readsBefore(positions.appearance, positions.haptics));
  assert.ok(readsBefore(positions.haptics, positions.widget));
  assert.ok(
    (positions.more?.y ?? 0) > (positions.widget?.y ?? 0),
    "the next scroll state starts below the complete preceding branch",
  );
  assert.equal(positions.more?.y, positions.memory?.y);
  assert.ok(readsBefore(positions.memory, positions.skills));
});

test("breaks cycles for ranking without producing giant coordinates", () => {
  const graph = {
    screens: ["one", "two", "three", "four"].map((id) => ({ id })),
    flows: [{ screenId: "one" }],
    transitions: [
      { fromScreenId: "one", destination: { kind: "screen", screenId: "two" } },
      { fromScreenId: "two", destination: { kind: "screen", screenId: "three" } },
      { fromScreenId: "three", destination: { kind: "screen", screenId: "one" } },
      { fromScreenId: "three", destination: { kind: "screen", screenId: "four" } },
    ],
  };
  const first = compactCanvasPositions(graph);
  const second = compactCanvasPositions(graph);

  assert.deepEqual(first, second);
  assert.ok(Math.max(...Object.values(first).map(({ x }) => x)) < 1_500);
  assert.ok((first.two?.x ?? 0) > (first.one?.x ?? 0));
  assert.ok((first.three?.x ?? 0) > (first.two?.x ?? 0));
});

test("barycentric ordering removes an avoidable crossing", () => {
  const graph = {
    screens: ["left-top", "left-bottom", "right-bottom", "right-top"].map((id) => ({ id })),
    flows: [{ screenId: "left-top" }, { screenId: "left-bottom" }],
    transitions: [
      { fromScreenId: "left-top", destination: { kind: "screen", screenId: "right-top" } },
      {
        fromScreenId: "left-bottom",
        destination: { kind: "screen", screenId: "right-bottom" },
      },
    ],
  };
  const positions = compactCanvasPositions(graph);

  assert.equal(positions["left-top"]?.y, positions["right-top"]?.y);
  assert.equal(positions["left-bottom"]?.y, positions["right-bottom"]?.y);
});

test("aligns independent linear continuations on stable rows", () => {
  const graph = {
    screens: ["memory", "storage", "import", "filter", "paste"].map((id) => ({ id })),
    flows: [{ screenId: "memory" }, { screenId: "storage" }],
    transitions: [
      { fromScreenId: "memory", destination: { kind: "screen", screenId: "import" } },
      { fromScreenId: "import", destination: { kind: "screen", screenId: "paste" } },
      { fromScreenId: "storage", destination: { kind: "screen", screenId: "filter" } },
    ],
  };
  const positions = compactCanvasPositions(graph);

  assert.equal(positions.memory?.y, positions.import?.y);
  assert.equal(positions.import?.y, positions.paste?.y);
  assert.equal(positions.storage?.y, positions.filter?.y);
  assert.notEqual(positions.filter?.y, positions.paste?.y);
});

test("keeps a direct continuation on its parent row despite a same-rank cross-link", () => {
  const graph = {
    screens: [
      "settings",
      "noise",
      "account-switcher",
      "other-branch",
      "edit-profile",
      "birth-year",
      "other-detail",
    ].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "noise" } },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "account-switcher" },
      },
      { fromScreenId: "noise", destination: { kind: "screen", screenId: "other-branch" } },
      {
        fromScreenId: "account-switcher",
        destination: { kind: "screen", screenId: "edit-profile" },
      },
      {
        // Deliberately saved first: this is an extra graph relationship, not
        // the primary visual owner of the Birth year dialog.
        fromScreenId: "other-branch",
        destination: { kind: "screen", screenId: "birth-year" },
      },
      {
        fromScreenId: "other-branch",
        destination: { kind: "screen", screenId: "other-detail" },
      },
      {
        fromScreenId: "edit-profile",
        destination: { kind: "screen", screenId: "birth-year" },
      },
    ],
  };

  const positions = compactCanvasPositions(graph);

  assert.equal(positions["account-switcher"]?.y, positions["edit-profile"]?.y);
  assert.equal(positions["edit-profile"]?.y, positions["birth-year"]?.y);
  assert.notEqual(positions["other-branch"]?.y, positions["birth-year"]?.y);
});

test("uses local connector geometry to promote the branch that removes a cross-link", () => {
  const graph = {
    screens: ["settings", "usage", "data-controls", "help", "advanced", "usage-detail", "end"].map(
      (id) => ({ id }),
    ),
    flows: [{ screenId: "settings" }],
    transitions: [
      // The authored/source order starts Usage first. Its long continuation
      // would make the direct Settings → Help edge take an avoidable dogleg.
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "usage" } },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "data-controls" },
      },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "help" } },
      { fromScreenId: "usage", destination: { kind: "screen", screenId: "usage-detail" } },
      { fromScreenId: "data-controls", destination: { kind: "screen", screenId: "help" } },
      { fromScreenId: "data-controls", destination: { kind: "screen", screenId: "advanced" } },
      { fromScreenId: "usage-detail", destination: { kind: "screen", screenId: "end" } },
    ],
  };

  const first = compactCanvasPositions(graph);
  const second = compactCanvasPositions(graph);

  assert.deepEqual(first, second, "the local lookahead is deterministic");
  assert.equal(first.settings?.y, first["data-controls"]?.y);
  assert.equal(first["data-controls"]?.y, first.help?.y);
  assert.equal(first.usage?.y, first["usage-detail"]?.y);
  assert.ok(
    (first.usage?.y ?? 0) > (first["data-controls"]?.y ?? 0),
    "the competing branch yields its primary row when that makes multiple links straighter",
  );
});

test("never promotes a later recorded action above an earlier one to improve routing", () => {
  const graph = {
    screens: ["settings", "usage", "data-controls", "help", "advanced", "usage-detail", "end"].map(
      (id) => ({ id }),
    ),
    flows: [{ screenId: "settings" }],
    transitions: [
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "usage" },
        sourceAnchor: { point: { x: 0.5, y: 0.18 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "data-controls" },
        sourceAnchor: { point: { x: 0.5, y: 0.48 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "help" },
        sourceAnchor: { point: { x: 0.5, y: 0.78 } },
      },
      { fromScreenId: "usage", destination: { kind: "screen", screenId: "usage-detail" } },
      { fromScreenId: "data-controls", destination: { kind: "screen", screenId: "help" } },
      { fromScreenId: "data-controls", destination: { kind: "screen", screenId: "advanced" } },
      { fromScreenId: "usage-detail", destination: { kind: "screen", screenId: "end" } },
    ],
  };

  const positions = compactCanvasPositions(graph);

  assert.ok((positions.usage?.y ?? 0) < (positions["data-controls"]?.y ?? 0));
});

test("will not read a fan backwards to straighten a cross-link", () => {
  const graph = {
    screens: [
      "settings",
      "account",
      "appearance",
      "usage",
      "data-controls",
      "help",
      "advanced",
      "usage-detail",
      "end",
    ].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      // The same cross-link as the promotion above, but Data controls is now the
      // fourth thing on the screen rather than the second. Promoting it would
      // read four screens out of the order somebody opened them in.
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "account" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "appearance" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "usage" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "data-controls" } },
      { fromScreenId: "settings", destination: { kind: "screen", screenId: "help" } },
      { fromScreenId: "usage", destination: { kind: "screen", screenId: "usage-detail" } },
      { fromScreenId: "data-controls", destination: { kind: "screen", screenId: "help" } },
      { fromScreenId: "data-controls", destination: { kind: "screen", screenId: "advanced" } },
      { fromScreenId: "usage-detail", destination: { kind: "screen", screenId: "end" } },
    ],
  };

  const positions = compactCanvasPositions(graph);

  assert.ok(readsBefore(positions.account, positions.appearance));
  assert.ok(readsBefore(positions.appearance, positions.usage));
  assert.ok(readsBefore(positions.usage, positions["data-controls"]));
  assert.ok(readsBefore(positions["data-controls"], positions.help));
});

test("preserves recorded sibling order while keeping each continuation on its branch row", () => {
  const graph = {
    // Deliberately scramble storage order. The path order is the user's UI order.
    screens: ["root", "paste", "customize", "memory", "import", "data", "filter"].map((id) => ({
      id,
    })),
    flows: [{ screenId: "root" }],
    transitions: [
      { fromScreenId: "root", destination: { kind: "screen", screenId: "data" } },
      { fromScreenId: "data", destination: { kind: "screen", screenId: "filter" } },
      { fromScreenId: "root", destination: { kind: "screen", screenId: "memory" } },
      { fromScreenId: "memory", destination: { kind: "screen", screenId: "import" } },
      { fromScreenId: "import", destination: { kind: "screen", screenId: "paste" } },
      { fromScreenId: "root", destination: { kind: "screen", screenId: "customize" } },
    ],
  };
  const positions = compactCanvasPositions(graph);

  assert.ok(readsBefore(positions.data, positions.memory));
  assert.ok(readsBefore(positions.memory, positions.customize));
  assert.equal(positions.data?.y, positions.filter?.y);
  assert.equal(positions.memory?.y, positions.import?.y);
  assert.equal(positions.import?.y, positions.paste?.y);
  assert.ok(
    (positions.customize?.x ?? 0) > (positions.paste?.x ?? 0),
    "a branch packed beside another starts past the whole reach of it",
  );
});

test("uses captured source action order for a fan-out even when transitions were saved out of order", () => {
  const graph = {
    screens: ["settings", "bottom", "top", "middle"].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "bottom" },
        sourceAnchor: { point: { x: 0.5, y: 0.84 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "top" },
        sourceAnchor: { point: { x: 0.5, y: 0.16 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "middle" },
        sourceAnchor: { point: { x: 0.5, y: 0.5 } },
      },
    ],
  };

  const positions = compactCanvasPositions(graph);

  assert.ok(readsBefore(positions.top, positions.middle));
  assert.ok(readsBefore(positions.middle, positions.bottom));
});

test("uses horizontal source-anchor order for top and bottom port fans", () => {
  const graph = {
    screens: ["source", "right-action", "left-action"].map((id) => ({ id })),
    flows: [{ screenId: "source" }],
    transitions: [
      {
        fromScreenId: "source",
        destination: { kind: "screen", screenId: "right-action" },
        sourceAnchor: { point: { x: 0.85, y: 0.1 } },
        presentation: { sourcePort: "bottom" },
      },
      {
        fromScreenId: "source",
        destination: { kind: "screen", screenId: "left-action" },
        sourceAnchor: { point: { x: 0.15, y: 0.9 } },
        presentation: { sourcePort: "bottom" },
      },
    ],
  };

  const positions = compactCanvasPositions(graph);

  assert.ok(readsBefore(positions["left-action"], positions["right-action"]));
});

test("orders sibling targets by the captured control rect centre, not an arbitrary tap", () => {
  const graph = {
    screens: ["settings", "bottom", "top", "middle"].map((id) => ({ id })),
    flows: [{ screenId: "settings" }],
    transitions: [
      // Deliberately saved out of visual order. The tap happened low in the
      // top cell, but the rect proves which control the user actually chose.
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "top" },
        sourceAnchor: {
          point: { x: 0.5, y: 0.86 },
          rect: { x: 0.08, y: 0.1, width: 0.84, height: 0.12 },
        },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "bottom" },
        sourceAnchor: {
          point: { x: 0.5, y: 0.12 },
          rect: { x: 0.08, y: 0.78, width: 0.84, height: 0.12 },
        },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "middle" },
        sourceAnchor: {
          point: { x: 0.5, y: 0.94 },
          rect: { x: 0.08, y: 0.44, width: 0.84, height: 0.12 },
        },
      },
    ],
  };

  const positions = compactCanvasPositions(graph);

  assert.ok(readsBefore(positions.top, positions.middle));
  assert.ok(readsBefore(positions.middle, positions.bottom));
});

test("uses the source frame's displayed orientation when ordering an anchored fan", () => {
  const graph = {
    screens: ["source", "displayed-bottom", "displayed-top"].map((id) => ({ id })),
    flows: [{ screenId: "source" }],
    transitions: [
      // A left-rotated frame maps logical X to displayed Y inversely. This
      // edge is intentionally saved first even though its control is lower
      // in the frame the person sees.
      {
        fromScreenId: "source",
        destination: { kind: "screen", screenId: "displayed-bottom" },
        sourceAnchor: {
          point: { x: 0.04, y: 0.5 },
          rect: { x: 0.04, y: 0.12, width: 0.12, height: 0.76 },
        },
        presentation: { sourcePort: "right" },
      },
      {
        fromScreenId: "source",
        destination: { kind: "screen", screenId: "displayed-top" },
        sourceAnchor: {
          point: { x: 0.96, y: 0.5 },
          rect: { x: 0.84, y: 0.12, width: 0.12, height: 0.76 },
        },
        presentation: { sourcePort: "right" },
      },
    ],
  };

  const positions = compactCanvasPositions(graph, {
    sourceRotationFor: () => "left",
  });

  assert.ok(
    readsBefore(positions["displayed-top"], positions["displayed-bottom"]),
    "the displayed top action should still be read before the displayed bottom action",
  );
});

test("keeps Grok Settings iPad branches in the recorded control order", () => {
  const graph = {
    screens: ["settings", "connectors", "skills", "customize", "appearance", "usage"].map((id) => ({
      id,
    })),
    flows: [{ screenId: "settings" }],
    // These are the current iPad map's source coordinates, intentionally
    // stored in a different order from their vertical Settings-list order.
    transitions: [
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "skills" },
        sourceAnchor: { point: { x: 0.5, y: 0.8776978417266187 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "usage" },
        sourceAnchor: { point: { x: 0.5, y: 0.36810551558752996 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "connectors" },
        sourceAnchor: { point: { x: 0.5, y: 0.9304556354916067 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "appearance" },
        sourceAnchor: { point: { x: 0.5, y: 0.49160671462829736 } },
      },
      {
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "customize" },
        sourceAnchor: { point: { x: 0.5, y: 0.8249400479616307 } },
      },
    ],
  };

  const positions = compactCanvasPositions(graph);
  const ordered = ["usage", "appearance", "customize", "skills", "connectors"];

  // Five screens that open nothing else wrap into a block rather than a column,
  // so the recorded control order reads as one wrapped list: left to right, then
  // down to the next row.
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = positions[ordered[index - 1]!]!;
    const next = positions[ordered[index]!]!;
    assert.ok(
      next.y > previous.y || (next.y === previous.y && next.x > previous.x),
      `${ordered[index - 1]} should still be read before ${ordered[index]}`,
    );
  }
  assert.ok(
    new Set(ordered.map((id) => positions[id]!.y)).size < ordered.length,
    "the fan should not spend one row per screen",
  );
  for (const point of Object.values(positions)) {
    assert.equal(point.x % DEFAULT_CANVAS_GRID_SPACING, 0);
    assert.equal(point.y % DEFAULT_CANVAS_GRID_SPACING, 0);
  }
});

test("uses durable transition order for equal recorded source coordinates", () => {
  const graph = {
    screens: ["source", "first", "second"].map((id) => ({ id })),
    flows: [{ screenId: "source" }],
    transitions: [
      {
        fromScreenId: "source",
        destination: { kind: "screen", screenId: "first" },
        sourceAnchor: { point: { x: 0.5, y: 0.5 } },
      },
      {
        fromScreenId: "source",
        destination: { kind: "screen", screenId: "second" },
        sourceAnchor: { point: { x: 0.5, y: 0.5 } },
      },
    ],
  };

  const first = compactCanvasPositions(graph);
  const second = compactCanvasPositions(graph);

  assert.deepEqual(first, second);
  assert.ok(readsBefore(first.first, first.second));
});
