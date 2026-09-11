import { expect, it } from "vitest";
import { snapMapPreview } from "./map-alignment";

it("aligns nearby preview tops and reports the guide", () => {
  const result = snapMapPreview(
    { x: 300, y: 103, width: 100, height: 200 },
    [{ x: 0, y: 100, width: 100, height: 200 }],
    1,
  );
  expect(result.dy).toBe(-3);
  expect(result.dx).toBe(0);
  expect(result.guides).toContainEqual({ axis: "y", value: 100, from: -12, to: 412 });
});
it("uses screen-space tolerance at different zoom levels", () => {
  const moving = { x: 200, y: 110, width: 100, height: 200 };
  const neighbors = [{ x: 0, y: 100, width: 100, height: 200 }];
  expect(snapMapPreview(moving, neighbors, 0.5).dy).toBe(-10);
  expect(snapMapPreview(moving, neighbors, 1).dy).toBe(0);
});
it("ignores distant screens and chooses the closest alignment", () => {
  expect(
    snapMapPreview(
      { x: 1000, y: 103, width: 100, height: 200 },
      [{ x: 0, y: 100, width: 100, height: 200 }],
      1,
    ).guides,
  ).toEqual([]);
  expect(
    snapMapPreview(
      { x: 300, y: 103, width: 100, height: 200 },
      [
        { x: 0, y: 100, width: 100, height: 200 },
        { x: 100, y: 102, width: 100, height: 200 },
      ],
      1,
    ).dy,
  ).toBe(-1);
});
