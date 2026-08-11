import assert from "node:assert/strict";
import test from "node:test";
import { compactCanvasPositions } from "./app-map-auto-layout";

test("lays out every screen once in a tall left-to-right topology", () => {
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
  assert.ok(
    new Set(Object.values(positions).map(({ y }) => y)).size >= 14,
    "wide branches should spend vertical space before horizontal space",
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
  assert.ok((positions.privacy?.x ?? 0) > (positions["settings-about"]?.x ?? 0));
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
