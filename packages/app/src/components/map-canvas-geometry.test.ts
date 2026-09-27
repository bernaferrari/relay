import { describe, expect, it } from "vitest";
import { containedImageRect, layoutMapScreens } from "./map-canvas-geometry";

describe("containedImageRect", () => {
  it("letterboxes a portrait image inside a landscape node", () => {
    expect(
      containedImageRect({ x: 10, y: 20, width: 200, height: 300 }, { width: 100, height: 200 }),
    ).toEqual({
      x: 35,
      y: 20,
      width: 150,
      height: 300,
    });
  });

  it("letterboxes a landscape image inside a portrait node", () => {
    expect(
      containedImageRect({ x: 10, y: 20, width: 200, height: 300 }, { width: 200, height: 100 }),
    ).toEqual({
      x: 10,
      y: 120,
      width: 200,
      height: 100,
    });
  });

  it("aligns browser screenshots beneath the title when top aligned", () => {
    expect(
      containedImageRect(
        { x: 10, y: 20, width: 200, height: 300 },
        { width: 200, height: 100 },
        "top",
      ),
    ).toEqual({ x: 10, y: 20, width: 200, height: 100 });
  });

  it("fails closed for invalid dimensions", () => {
    expect(
      containedImageRect({ x: 0, y: 0, width: 200, height: 300 }, { width: 0, height: 100 }),
    ).toBeUndefined();
  });
});

it("aligns horizontal siblings on one row and keeps continuations in their column", () => {
  const screens = ["root", "a", "b", "c", "next"].map((id) => ({
    id,
    title: id,
    variantCount: 0,
    variants: [],
    coveringTests: [],
    recentFailures: [],
  }));
  const paths = [
    ...["a", "b", "c"].map((to) => ({ from: "root", to })),
    { from: "b", to: "next" },
  ].map(({ from, to }) => ({
    id: `${from}-${to}`,
    fromScreenId: from,
    toScreenId: to,
    fromTitle: from,
    label: to,
    coveringTests: [],
  }));
  const points = layoutMapScreens(screens, paths, "horizontal");
  expect(points.get("a")!.y).toBe(points.get("b")!.y);
  expect(points.get("c")!.y).toBe(points.get("b")!.y);
  expect(points.get("next")!.x).toBe(points.get("b")!.x);
  expect(points.get("a")!.x).toBeLessThan(points.get("b")!.x);
  expect(points.get("b")!.x).toBeLessThan(points.get("c")!.x);
});
