import { describe, expect, it } from "vitest";
import {
  talkBackItemAtPoint,
  talkBackOverlayBox,
  validAccessibilityLabelMode,
} from "./talkback-overlay";

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON() {
      return this;
    },
  };
}

describe("talkBackOverlayBox", () => {
  it("maps device pixels onto a letterboxed canvas", () => {
    const canvas = {
      width: 1080,
      height: 2400,
      getBoundingClientRect: () => rect(100, 50, 270, 600),
    };
    const parent = { getBoundingClientRect: () => rect(100, 50, 270, 600) };
    const box = talkBackOverlayBox(canvas, parent, { x: 108, y: 240, width: 216, height: 120 });
    expect(box).toEqual({ left: 27, top: 60, width: 54, height: 30 });
  });

  it("ignores empty geometry", () => {
    const canvas = {
      width: 100,
      height: 100,
      getBoundingClientRect: () => rect(0, 0, 100, 100),
    };
    const parent = { getBoundingClientRect: () => rect(0, 0, 100, 100) };
    expect(
      talkBackOverlayBox(canvas, parent, { x: 0, y: 0, width: 0, height: 10 }),
    ).toBeUndefined();
  });

  it("picks the smallest control under the pointer", () => {
    const row = { id: "row", box: { left: 0, top: 0, width: 200, height: 80 } };
    const label = { id: "label", box: { left: 16, top: 20, width: 80, height: 24 } };
    expect(talkBackItemAtPoint([row, label], { x: 20, y: 24 })?.id).toBe("label");
    expect(talkBackItemAtPoint([row, label], { x: 4, y: 4 })?.id).toBe("row");
    expect(talkBackItemAtPoint([row, label], { x: 400, y: 4 })).toBeUndefined();
  });

  it("treats an unknown saved mode as off", () => {
    expect(validAccessibilityLabelMode("always")).toBe("always");
    expect(validAccessibilityLabelMode("hover")).toBe("hover");
    expect(validAccessibilityLabelMode("listen")).toBe("off");
  });
});
