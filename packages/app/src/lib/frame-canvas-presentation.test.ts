import assert from "node:assert/strict";
import test from "node:test";
import {
  frameCanvasItems,
  frameToSrc,
  runFrameCanvasItems,
  shortLabel,
} from "./frame-canvas-presentation";

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

test("run frame presentation deduplicates evidence and preserves failure context", () => {
  const frame = {
    path: "frames/stopped.png",
    capturedAt: 3,
    mime: "image/png",
    base64: "abc",
    caption: "Confirmation screen",
  };
  const items = runFrameCanvasItems({
    job: {
      id: "run-1",
      action: "logout",
      status: "error",
      queuedAt: 1,
      logs: [],
      frames: [frame],
      steps: [
        {
          id: "step-1",
          index: 0,
          kind: "tap",
          tone: "danger",
          title: "Confirm logout",
          startedAt: 2,
          status: "error",
          glyphs: [],
          frames: [frame],
          log: "Stopped",
        },
      ],
    },
    persistedFrameUrl: () => "unused",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.caption, "Confirmation screen");
  assert.equal(items[0]?.status, "fail");
  assert.equal(items[0]?.src, "data:image/png;base64,abc");
});
