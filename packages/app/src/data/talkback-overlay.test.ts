import { describe, expect, it } from "vitest";
import {
  ACCESSIBILITY_LABEL_MODE_OPTIONS,
  currentAccessibilityInspection,
  distinctTalkBackOverlays,
  retainAccessibilityObservation,
  talkBackItemAtPoint,
  talkBackOverlayBox,
  validAccessibilityLabelMode,
  visibleTalkBackOverlayItems,
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
  it("deduplicates equivalent labels while retaining different controls and raw review rows", () => {
    const settings = {
      id: "sidebar.settings.button:0:76:768",
      identifier: "sidebar.settings.button",
      index: 1,
      name: "Settings",
      announcement: "Settings, Button",
      role: "Button",
      interactive: true,
      issues: [],
      rect: { x: 76, y: 768, width: 48, height: 48 },
    };
    const repeated = { ...settings, index: 2 };
    const otherName = { ...settings, name: "Account", announcement: "Account, Button", index: 3 };
    const otherBounds = { ...settings, rect: { ...settings.rect, width: 96 }, index: 4 };
    const raw = [settings, repeated, otherName, otherBounds];
    const projected = distinctTalkBackOverlays(raw);
    expect(projected.map(({ item }) => item)).toEqual([settings, otherName, otherBounds]);
    expect(new Set(projected.map(({ key }) => key)).size).toBe(3);
    expect(
      distinctTalkBackOverlays([...raw].reverse())
        .map(({ key }) => key)
        .sort(),
    ).toEqual(projected.map(({ key }) => key).sort());
    expect(raw).toHaveLength(4);
    expect(raw[1]).toBe(repeated);
  });
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

  it("keeps overlay content coordinates stable when the enlarged canvas is panned", () => {
    const parent = {
      scrollLeft: 30,
      scrollTop: 120,
      getBoundingClientRect: () => rect(100, 50, 200, 300),
    };
    const canvas = {
      width: 400,
      height: 800,
      getBoundingClientRect: () => rect(70, -70, 400, 800),
    };
    const box = talkBackOverlayBox(canvas, parent, { x: 80, y: 240, width: 100, height: 40 });
    expect(box).toEqual({ left: 80, top: 240, width: 100, height: 40 });
    parent.scrollTop = 180;
    canvas.getBoundingClientRect = () => rect(70, -130, 400, 800);
    expect(talkBackOverlayBox(canvas, parent, { x: 80, y: 240, width: 100, height: 40 })).toEqual(
      box,
    );
  });

  it("scales full-resolution accessibility bounds independently of reduced video", () => {
    const canvas = {
      width: 496,
      height: 1080,
      getBoundingClientRect: () => rect(100, 50, 270, 585),
    };
    const parent = { getBoundingClientRect: () => rect(0, 0, 470, 700) };
    expect(
      talkBackOverlayBox(
        canvas,
        parent,
        { x: 108, y: 234, width: 216, height: 120 },
        { width: 1080, height: 2340 },
      ),
    ).toEqual({ left: 127, top: 108.5, width: 54, height: 30 });
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
    expect(validAccessibilityLabelMode("listen")).toBe("hover");
  });

  it("does not let a late observation overwrite a newer target", () => {
    const previous = {
      inspectable: true,
      review: { items: [], issues: [], errorCount: 0, warningCount: 0 },
      targetId: "pixel-2",
      observationId: "pixel-2:2",
    };
    const retained = retainAccessibilityObservation({
      currentId: "pixel-2:2",
      incomingId: "pixel-1:1",
      previous,
      next: {
        inspectable: true,
        review: { items: [], issues: [], errorCount: 0, warningCount: 0 },
        targetId: "pixel-1",
      },
    });
    expect(retained?.observationId).toBe("pixel-2:2");
    expect(retained?.stale).toBe(false);
  });

  it("marks a previous observation stale when the current target changes", () => {
    const previous = {
      inspectable: true,
      review: { items: [], issues: [], errorCount: 0, warningCount: 0 },
      targetId: "pixel-1",
      observationId: "pixel-1:1",
    };
    const retained = retainAccessibilityObservation({
      currentId: "pixel-2:1",
      incomingId: "pixel-1:1",
      previous,
      next: {
        inspectable: true,
        review: { items: [], issues: [], errorCount: 0, warningCount: 0 },
        targetId: "pixel-1",
      },
    });
    expect(retained?.observationId).toBe("pixel-1:1");
    expect(retained?.stale).toBe(true);
  });

  it("does not paint stale or foreign-target names", () => {
    const review = {
      items: [
        {
          id: "a",
          index: 0,
          announcement: "Close",
          name: "Close",
          interactive: true,
          issues: [],
        },
      ],
      issues: [],
      errorCount: 0,
      warningCount: 0,
    };
    expect(
      visibleTalkBackOverlayItems(
        { inspectable: true, review, targetId: "pixel-1", stale: true },
        "pixel-1",
      ),
    ).toEqual([]);
    expect(
      visibleTalkBackOverlayItems(
        { inspectable: true, review, targetId: "pixel-1", stale: false },
        "pixel-2",
      ),
    ).toEqual([]);
    expect(
      visibleTalkBackOverlayItems(
        { inspectable: true, review, targetId: "pixel-1", stale: false },
        "pixel-1",
      ),
    ).toEqual(review.items);
    expect(
      currentAccessibilityInspection(
        {
          inspectable: true,
          review,
          targetId: "pixel-1",
          observationId: "pixel-1:0",
        },
        "pixel-1:1",
      ),
    ).toEqual({ overlayItems: [] });
  });

  it("exposes hover and always as the saved setting choices", () => {
    expect(ACCESSIBILITY_LABEL_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "off",
      "hover",
      "always",
    ]);
  });
});
