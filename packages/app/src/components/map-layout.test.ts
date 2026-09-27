import { expect, it } from "vitest";
import { layoutMapGraph, separateMapScreens, reserveStraightConnections } from "./map-layout";
it("keeps continuations straight and centers branching screens", () => {
  const points = layoutMapGraph(
    ["home", "settings", "a", "b", "c"],
    [{ from: "home", to: "settings" }, ...["a", "b", "c"].map((to) => ({ from: "settings", to }))],
    368,
    428,
  );
  expect(points.get("home")!.y).toBe(points.get("settings")!.y);
  expect(points.get("settings")!.y).toBe(points.get("b")!.y);
  expect(points.get("a")!.y).toBeLessThan(points.get("b")!.y);
  expect(points.get("c")!.y).toBeGreaterThan(points.get("b")!.y);
});
it("places every screen once through cycles, shared destinations, and disconnected components", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const edges = [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "c", to: "d" },
    { from: "d", to: "a" },
  ];
  const points = layoutMapGraph(ids, edges, 368, 428);
  expect(points.size).toBe(ids.length);
  for (const [id, a] of points)
    for (const [other, b] of points)
      if (id !== other && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(428);
  expect(layoutMapGraph(ids, edges, 368, 428)).toEqual(points);
});
it("packs sibling subtrees without overlapping nodes at any depth", () => {
  const ids = Array.from({ length: 41 }, (_, i) => String(i));
  const edges = ids
    .slice(1)
    .map((id) => ({ from: String(Math.floor((Number(id) - 1) / 3)), to: id }));
  const points = layoutMapGraph(ids, edges, 368, 428);
  for (const [id, a] of points)
    for (const [other, b] of points)
      if (id !== other && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(428);
});

it("keeps saved positions from colliding with automatically placed neighbors", () => {
  const points = new Map([
    ["automatic", { x: 1260, y: 6000 }],
    ["saved", { x: 1260, y: 6008 }],
    ["other", { x: 1360, y: 6010 }],
  ]);
  const resolved = separateMapScreens(points, new Set(["saved"]), 208, 388);
  expect(resolved.get("saved")).toEqual(points.get("saved"));
  for (const [id, a] of resolved)
    for (const [other, b] of resolved)
      if (id !== other && Math.abs(a.x - b.x) < 240)
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(420);
  expect(separateMapScreens(resolved, new Set(["saved"]), 208, 388)).toEqual(resolved);
});

it("staggers sibling subtrees while keeping their continuations aligned", () => {
  const points = layoutMapGraph(
    ["root", "a", "b", "child"],
    [
      { from: "root", to: "a" },
      { from: "root", to: "b" },
      { from: "b", to: "child" },
    ],
    560,
    428,
    true,
  );
  expect(points.get("b")!.x - points.get("a")!.x).toBe(280);
  expect(points.get("b")!.y).toBe(points.get("child")!.y);
});

it("moves an intervening branch out of a straight continuation", () => {
  const points = new Map([
    ["widget", { x: 0, y: 400 }],
    ["add", { x: 1120, y: 400 }],
    ["topup", { x: 560, y: 400 }],
  ]);
  const result = reserveStraightConnections(points, [{ from: "widget", to: "add" }], 208, 388);
  expect(result.get("widget")!.y).toBe(result.get("add")!.y);
  expect(result.get("topup")!.y).toBeGreaterThan(result.get("widget")!.y + 194);
});

it("staggers destination groups while keeping each set of siblings in one column", () => {
  const points = layoutMapGraph(
    ["root", "a", "b", "a1", "a2", "b1", "b2"],
    [
      { from: "root", to: "a" },
      { from: "root", to: "b" },
      { from: "a", to: "a1" },
      { from: "a", to: "a2" },
      { from: "b", to: "b1" },
      { from: "b", to: "b2" },
    ],
    560,
    428,
    true,
  );
  expect(points.get("b")!.x - points.get("a")!.x).toBe(280);
  expect(points.get("a1")!.x).toBe(points.get("a2")!.x);
  expect(points.get("b1")!.x).toBe(points.get("b2")!.x);
  expect(points.get("b1")!.x - points.get("a1")!.x).toBe(280);
});

it("does not restart staggering in later branching columns", () => {
  const edges = [
    { from: "home", to: "settings" },
    { from: "settings", to: "usage" },
    { from: "settings", to: "data" },
    { from: "data", to: "cloud" },
    { from: "data", to: "delete" },
    { from: "cloud", to: "filter" },
    { from: "cloud", to: "details" },
  ];
  const ids = [...new Set(edges.flatMap(({ from, to }) => [from, to]))];
  const points = layoutMapGraph(ids, edges, 560, 428, true);
  expect(points.get("data")!.x - points.get("usage")!.x).toBe(280);
  expect(points.get("cloud")!.x).toBe(points.get("delete")!.x);
  expect(points.get("filter")!.x).toBe(points.get("details")!.x);
  expect(points.get("filter")!.x - points.get("cloud")!.x).toBe(560);
  expect(points.get("home")!.y).toBe(points.get("settings")!.y);
});
