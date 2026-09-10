import { describe, expect, it } from "vitest";
import { containedImageRect } from "./map-canvas-geometry";

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
