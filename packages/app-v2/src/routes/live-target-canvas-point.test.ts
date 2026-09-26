import { describe, expect, it } from "vitest";
import { containedFrameRect } from "./live-target-canvas";

describe("containedFrameRect", () => {
  it("accounts for the letterbox when the canvas is taller than the frame", () => {
    // A 1280x800 frame drawn into a 742x683 element: bands above and below.
    const drawn = containedFrameRect({ left: 288, top: 136, width: 742, height: 683 }, 1280, 800);
    expect(drawn.width).toBeCloseTo(742);
    expect(drawn.height).toBeCloseTo(463.75);
    expect(drawn.top).toBeCloseTo(136 + (683 - 463.75) / 2);
    // A click on Imagine (viewport y 313) maps to frame y ~115, not ~207.
    expect(Math.round(((313 - drawn.top) / drawn.height) * 800)).toBe(116);
  });

  it("is the element itself when aspects match", () => {
    expect(containedFrameRect({ left: 0, top: 0, width: 640, height: 400 }, 1280, 800)).toEqual({
      left: 0,
      top: 0,
      width: 640,
      height: 400,
    });
  });
});
