import { expect, it } from "vitest";
import { separateMapScreens } from "./map-layout";

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
