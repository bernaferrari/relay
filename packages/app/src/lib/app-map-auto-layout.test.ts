import assert from "node:assert/strict";
import test from "node:test";
import { compactGroupedCanvasPositions } from "./app-map-auto-layout";

const screens = Array.from({ length: 43 }, (_, index) => ({ id: `screen-${index}` }));
const transitions = [
  {
    fromScreenId: "screen-9",
    destination: { kind: "screen", screenId: "screen-10" },
    label: "Scroll",
  },
  {
    fromScreenId: "screen-10",
    destination: { kind: "screen", screenId: "screen-11" },
    label: "Scroll to Kids Mode",
  },
];
const groups = [
  { id: "account", screenIds: screens.slice(0, 9).map(({ id }) => id) },
  { id: "app", screenIds: screens.slice(9, 20).map(({ id }) => id) },
  { id: "data", screenIds: screens.slice(20, 32).map(({ id }) => id) },
  { id: "safety", screenIds: screens.slice(32, 39).map(({ id }) => id) },
  { id: "help", screenIds: screens.slice(39).map(({ id }) => id) },
];

test("large grouped maps are packed into readable sections", () => {
  const positions = compactGroupedCanvasPositions(
    { screens, flows: [{ screenId: "screen-9" }], transitions },
    groups as never,
  );
  assert.equal(Object.keys(positions).length, 43);
  assert.equal(new Set(Object.values(positions).map(({ x, y }) => `${x}:${y}`)).size, 43);
  assert.deepEqual(positions["screen-9"], { x: 0, y: 0 });
  assert.equal(positions["screen-10"]?.x, positions["screen-9"]?.x);
  assert.ok((positions["screen-10"]?.y ?? 0) > (positions["screen-9"]?.y ?? 0));
  assert.ok(Math.max(...Object.values(positions).map(({ x }) => x)) < 2400);
  assert.ok(Math.max(...Object.values(positions).map(({ y }) => y)) < 2700);
});

test("layout is deterministic and keeps ungrouped screens", () => {
  const graph = {
    screens: screens.slice(0, 5),
    flows: [{ screenId: "screen-3" }],
    transitions: [],
  };
  const inputGroups = [{ id: "main", screenIds: ["screen-3", "screen-4"] }] as never;
  const first = compactGroupedCanvasPositions(graph, inputGroups);
  const second = compactGroupedCanvasPositions(graph, inputGroups);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), graph.screens.map(({ id }) => id).sort());
});

test("cross-group dependencies form a compact non-overlapping island", () => {
  const graph = {
    screens: [{ id: "root" }, { id: "account" }, { id: "data" }, { id: "legal" }],
    flows: [{ screenId: "root" }],
    transitions: [
      { fromScreenId: "root", destination: { kind: "screen", screenId: "account" } },
      { fromScreenId: "root", destination: { kind: "screen", screenId: "data" } },
      { fromScreenId: "root", destination: { kind: "screen", screenId: "legal" } },
    ],
  };
  const positions = compactGroupedCanvasPositions(graph, [
    { id: "root-group", screenIds: ["root"] },
    { id: "account-group", screenIds: ["account"] },
    { id: "data-group", screenIds: ["data"] },
    { id: "legal-group", screenIds: ["legal"] },
  ] as never);

  const values = Object.values(positions);
  assert.equal(new Set(values.map(({ x, y }) => `${x}:${y}`)).size, 4);
  assert.ok(Math.max(...values.map(({ x }) => x)) <= 700);
  assert.ok(Math.max(...values.map(({ y }) => y)) <= 338);
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const a = values[left]!;
      const b = values[right]!;
      assert.ok(a.x + 240 <= b.x || b.x + 240 <= a.x || a.y + 230 <= b.y || b.y + 230 <= a.y);
    }
  }
});

test("orders topology lanes to remove an avoidable crossing", () => {
  const graph = {
    screens: [
      { id: "left-top" },
      { id: "left-bottom" },
      { id: "right-bottom" },
      { id: "right-top" },
    ],
    flows: [{ screenId: "left-top" }, { screenId: "left-bottom" }],
    transitions: [
      { fromScreenId: "left-top", destination: { kind: "screen", screenId: "right-top" } },
      { fromScreenId: "left-bottom", destination: { kind: "screen", screenId: "right-bottom" } },
    ],
  };
  const positions = compactGroupedCanvasPositions(graph, [
    { id: "main", screenIds: graph.screens.map(({ id }) => id) },
  ] as never);

  assert.equal(positions["left-top"]?.y, positions["right-top"]?.y);
  assert.equal(positions["left-bottom"]?.y, positions["right-bottom"]?.y);
});

test("deep flows turn into a taller snake instead of an endless row", () => {
  const graph = {
    screens: [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }],
    flows: [{ screenId: "one" }],
    transitions: [
      { fromScreenId: "one", destination: { kind: "screen", screenId: "two" } },
      { fromScreenId: "two", destination: { kind: "screen", screenId: "three" } },
      { fromScreenId: "three", destination: { kind: "screen", screenId: "four" } },
    ],
  };
  const positions = compactGroupedCanvasPositions(graph, [
    { id: "main", screenIds: graph.screens.map(({ id }) => id) },
  ] as never);

  assert.equal(positions.one?.y, positions.two?.y);
  assert.equal(positions.two?.y, positions.three?.y);
  assert.equal(positions.three?.x, positions.four?.x);
  assert.ok((positions.four?.y ?? 0) > (positions.three?.y ?? 0));
  assert.equal(new Set(Object.values(positions).map(({ x }) => x)).size, 3);
});

test("wide topology layers grow vertically before adding another column", () => {
  const roots = Array.from({ length: 5 }, (_, index) => ({ id: `root-${index}` }));
  const leaves = Array.from({ length: 5 }, (_, index) => ({ id: `leaf-${index}` }));
  const graph = {
    screens: [...roots, ...leaves],
    flows: roots.map(({ id }) => ({ screenId: id })),
    transitions: roots.map(({ id }, index) => ({
      fromScreenId: id,
      destination: { kind: "screen", screenId: leaves[index]!.id },
    })),
  };
  const positions = compactGroupedCanvasPositions(graph, [
    { id: "main", screenIds: graph.screens.map(({ id }) => id) },
  ] as never);

  assert.equal(new Set(roots.map(({ id }) => positions[id]?.x)).size, 1);
  assert.equal(new Set(leaves.map(({ id }) => positions[id]?.x)).size, 1);
  assert.notEqual(positions[roots[0]!.id]?.x, positions[leaves[0]!.id]?.x);
});
