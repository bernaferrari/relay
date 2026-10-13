import assert from "node:assert/strict";
import test from "node:test";
import { failingStepFrame } from "./failing-step-frame.js";

// Frames from a real Android run that stopped at "Type text".
const runFrames = [
  { path: "frames/010.png", caption: "step:step-d8f2:Choose Fast", capturedAt: 273707 },
  { path: "frames/011.png", caption: "after · Type text", capturedAt: 276384 },
  { path: "frames/012.png", caption: "failed:primary:Type text", capturedAt: 277161 },
  { path: "frames/013.png", caption: "after · Run saved Test", capturedAt: 278666 },
];

test("the failure-time frame wins, even when later frames exist", () => {
  assert.deepEqual(
    failingStepFrame({
      stepFrames: [{ path: "frames/013.png" }],
      runFrames,
      startedAt: 273712,
      finishedAt: 278725,
    }),
    { path: "frames/012.png", moment: "failure" },
  );
});

test("without a failure frame, the last frame captured during the step's internal steps", () => {
  assert.deepEqual(
    failingStepFrame({
      stepFrames: [{ path: "frames/010.png" }, { path: "frames/011.png" }],
      runFrames: runFrames.filter((frame) => !frame.caption.startsWith("failed")).slice(0, 2),
      startedAt: 273741,
      finishedAt: 276568,
    }),
    { path: "frames/011.png", moment: "during" },
  );
});

test("a step that saved nothing shows the last screen before it started", () => {
  assert.deepEqual(
    failingStepFrame({ stepFrames: [], runFrames, startedAt: 276000, finishedAt: 276100 }),
    { path: "frames/010.png", moment: "before" },
  );
  assert.equal(failingStepFrame({ stepFrames: [], runFrames: [] }), undefined);
});
