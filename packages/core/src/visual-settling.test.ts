import assert from "node:assert/strict";
import test from "node:test";
import { captureSettledRaster } from "./visual-settling.js";

test("waits through animation even when the accessibility tree is already ready", async () => {
  const frames = ["old", "transition", "new", "new", "new"];
  const discarded: string[] = [];
  let elapsed = 0;
  const result = await captureSettledRaster({
    capture: async () => frames.shift()!,
    bytes: (frame) => Buffer.from(frame),
    discard: async (frame) => {
      discarded.push(frame);
    },
    wait: async (ms) => {
      elapsed += ms;
    },
  });
  assert.deepEqual(result, { value: "new", settled: true, samples: 4 });
  assert.equal(elapsed, 1500);
  assert.deepEqual(discarded, ["old", "transition", "new"]);
});

test("measured stability requires two matching frames", async () => {
  let samples = 0;
  const result = await captureSettledRaster({
    capture: async () => {
      samples += 1;
      return "same";
    },
    bytes: (frame) => Buffer.from(frame),
    wait: async () => {},
  });
  assert.equal(result.value, "same");
  assert.equal(result.settled, true);
  assert.ok(result.samples >= 2);
  assert.ok(samples >= 2);
});

test("bounds continuously changing content without claiming it settled", async () => {
  let samples = 0;
  const result = await captureSettledRaster({
    capture: async () => String(++samples),
    bytes: (frame) => Buffer.from(frame),
    wait: async () => {},
  });
  assert.deepEqual(result, { value: "4", settled: false, samples: 4 });
});

test("cleans up the last temporary frame when a later capture fails", async () => {
  let count = 0;
  const discarded: string[] = [];
  await assert.rejects(
    captureSettledRaster({
      capture: async () => {
        if (++count === 2) throw new Error("disconnected");
        return "one";
      },
      bytes: (frame) => Buffer.from(frame),
      discard: async (frame) => {
        discarded.push(frame);
      },
      wait: async () => {},
    }),
    /disconnected/,
  );
  assert.deepEqual(discarded, ["one"]);
});

test("slow captures exhaust the time budget without seven expensive probes", async () => {
  let clock = 0;
  let count = 0;
  const result = await captureSettledRaster({
    capture: async () => {
      clock += 1500;
      return String(++count);
    },
    bytes: (value) => Buffer.from(value),
    wait: async (ms) => {
      clock += ms;
    },
    clock: () => clock,
  });
  assert.deepEqual(result, { value: "2", settled: false, samples: 2 });
});
