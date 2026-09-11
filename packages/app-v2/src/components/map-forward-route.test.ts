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
  expect(routes.map((points) => points[1]!.x)).toEqual([236, 248, 260]);
  for (const points of routes) expect(points[1]!.x).toBeGreaterThan(208);
});
it("reverses downward lanes and reserves space for destination labels", () => {
  const routes = [0, 1, 2].map((slot) =>
    forwardRoute({ x: 100, y: slot * 20 }, { x: 650, y: 400 + slot * 100 }, 208, slot, 3),
  );
  expect(routes.map((points) => points[1]!.x)).toEqual([260, 248, 236]);
  for (const points of routes)
    expect(points.at(-1)!.x - points.at(-2)!.x).toBeGreaterThanOrEqual(128);
});

it("routes around a preview between the source and destination", () => {
  const obstacle = { x: 150, y: 100, width: 120, height: 220 };
  const route = avoidPreviewObstacles(
    [
      { x: 0, y: 200 },
      { x: 400, y: 200 },
    ],
    [obstacle],
  );
  expect(route.length).toBeGreaterThan(2);
  for (let i = 1; i < route.length; i++)
    expect(routeCrossesBox(route[i - 1]!, route[i]!, obstacle)).toBe(false);
  expect(route[0]).toEqual({ x: 0, y: 200 });
  expect(route.at(-1)).toEqual({ x: 400, y: 200 });
});
