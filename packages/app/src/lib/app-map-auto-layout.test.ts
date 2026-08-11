import assert from "node:assert/strict";
import test from "node:test";
import { compactGroupedCanvasPositions } from "./app-map-auto-layout";

const screens = Array.from({ length: 43 }, (_, index) => ({ id: `screen-${index}` }));
const groups = [
  { id: "account", screenIds: screens.slice(0, 9).map(({ id }) => id) },
  { id: "app", screenIds: screens.slice(9, 20).map(({ id }) => id) },
  { id: "data", screenIds: screens.slice(20, 32).map(({ id }) => id) },
  { id: "safety", screenIds: screens.slice(32, 39).map(({ id }) => id) },
  { id: "help", screenIds: screens.slice(39).map(({ id }) => id) },
];

test("large grouped maps are packed into readable sections", () => {
  const positions = compactGroupedCanvasPositions(
    { screens, flows: [{ screenId: "screen-9" }] },
    groups as never,
  );
  assert.equal(Object.keys(positions).length, 43);
  assert.equal(new Set(Object.values(positions).map(({ x, y }) => `${x}:${y}`)).size, 43);
  assert.deepEqual(positions["screen-9"], { x: 0, y: 0 });
  assert.ok(Math.max(...Object.values(positions).map(({ x }) => x)) < 2500);
  assert.ok(Math.max(...Object.values(positions).map(({ y }) => y)) < 2500);
});

test("layout is deterministic and keeps ungrouped screens", () => {
  const graph = { screens: screens.slice(0, 5), flows: [{ screenId: "screen-3" }] };
  const inputGroups = [{ id: "main", screenIds: ["screen-3", "screen-4"] }] as never;
  const first = compactGroupedCanvasPositions(graph, inputGroups);
  const second = compactGroupedCanvasPositions(graph, inputGroups);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), graph.screens.map(({ id }) => id).sort());
});
