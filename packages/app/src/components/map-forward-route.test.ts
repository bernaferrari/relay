import { expect, it } from "vitest";
import { forwardRoute, avoidPreviewObstacles, routeCrossesBox } from "./map-forward-route";
it("keeps straight continuations straight", () => {
  expect(forwardRoute({ x: 100, y: 50 }, { x: 500, y: 50 }, 208, 0, 1)).toEqual([
    { x: 100, y: 50 },
    { x: 500, y: 50 },
  ]);
});
it("separates ascending branches outside the source preview", () => {
  const routes = [0, 1, 2].map((slot) =>
    forwardRoute({ x: 100, y: 400 + slot * 20 }, { x: 650, y: slot * 100 }, 208, slot, 3),
  );
  expect(routes.map((points) => points[1]!.x)).toEqual([498, 510, 522]);
  for (const points of routes) expect(points[1]!.x).toBeGreaterThan(208);
});
it("reverses downward lanes and reserves space for destination labels", () => {
  const routes = [0, 1, 2].map((slot) =>
    forwardRoute({ x: 100, y: slot * 20 }, { x: 650, y: 400 + slot * 100 }, 208, slot, 3),
  );
  expect(routes.map((points) => points[1]!.x)).toEqual([522, 510, 498]);
  for (const points of routes)
    expect(points.at(-1)!.x - points.at(-2)!.x).toBeGreaterThanOrEqual(128);
});

it("leaves straight continuations straight so layout must clear their corridor", () => {
  const points = [
    { x: 0, y: 200 },
    { x: 400, y: 200 },
  ];
  expect(avoidPreviewObstacles(points, [{ x: 150, y: 100, width: 120, height: 220 }])).toEqual(
    points,
  );
});

it("moves an elbow later instead of adding a detour", () => {
  const obstacle = { x: 90, y: 120, width: 100, height: 100 };
  const route = avoidPreviewObstacles(
    [
      { x: 0, y: 50 },
      { x: 120, y: 50 },
      { x: 120, y: 300 },
      { x: 500, y: 300 },
    ],
    [obstacle],
  );
  expect(route).toHaveLength(4);
  for (let i = 1; i < route.length; i++)
    expect(routeCrossesBox(route[i - 1]!, route[i]!, obstacle)).toBe(false);
});
