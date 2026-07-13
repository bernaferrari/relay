import assert from "node:assert/strict";
import test from "node:test";
import { frameCanvasItems, frameToSrc, shortLabel } from "./frame-canvas-presentation";

test("frame presentation keeps labels compact and preserves source order", () => {
  assert.equal(shortLabel("Tap the primary action button"), "Tap the primary…");
  assert.equal(shortLabel("Step 12"), "Step 12");
  assert.equal(
    frameToSrc({
      id: "f1",
      capturedAt: 1,
      mime: "image/png",
      base64: "abc",
      bytes: 3,
      caption: "",
    }),
    "data:image/png;base64,abc",
  );
});

test("frame presentation maps a live run to screenshot nodes", () => {
  const items = frameCanvasItems({
    reviewed: {
      kind: "live",
      id: "job-1",
      ts: 1,
      job: {
        id: "job-1",
        action: "test",
        status: "ok",
        queuedAt: 1,
        logs: [],
        steps: [
          {
            id: "step-1",
            index: 0,
            kind: "tap",
            tone: "pass",
            title: "Tap",
            startedAt: 1,
            status: "ok",
            glyphs: [],
            frames: [],
            log: "",
          },
        ],
      },
    },
    liveFrames: [
      {
        id: "frame-1",
        capturedAt: 2,
        mime: "image/png",
        base64: "abc",
        bytes: 3,
        caption: "Tap send",
      },
    ],
    activeJob: null,
    persistedFrameUrl: () => "",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, "frame-1");
  assert.equal(items[0]?.status, "pass");
  assert.equal(items[0]?.edgeLabel, undefined);
});
