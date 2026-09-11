import { expect, it } from "vitest";
import { forwardRoute } from "./map-forward-route";
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
