import assert from "node:assert/strict";
import test from "node:test";
import { captureSettledRaster } from "./visual-settling.js";

test("stable waits through animation even when the accessibility tree is already ready", async () => {
  const frames = ["old", "transition", "new", "new", "new"];
  const discarded: string[] = [];
  let elapsed = 0;
  const result = await captureSettledRaster({
    policy: "stable",
    capture: async () => frames.shift()!,
    bytes: (frame) => Buffer.from(frame),
    discard: async (frame) => {
      discarded.push(frame);
    },
    wait: async (ms) => {
      elapsed += ms;
    },
  });
  assert.deepEqual(result, { value: "new", settled: true, samples: 4, stabilityMeasured: true });
  assert.equal(elapsed, 1500);
  assert.deepEqual(discarded, ["old", "transition", "new"]);
});

test("measured stability requires two matching frames", async () => {
  let samples = 0;
  const result = await captureSettledRaster({
    policy: "stable",
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
    policy: "stable",
    capture: async () => String(++samples),
    bytes: (frame) => Buffer.from(frame),
    wait: async () => {},
  });
  assert.deepEqual(result, { value: "4", settled: false, samples: 4, stabilityMeasured: true });
});

test("cleans up the last temporary frame when a later capture fails", async () => {
  let count = 0;
  const discarded: string[] = [];
  await assert.rejects(
    captureSettledRaster({
      policy: "stable",
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
    policy: "stable",
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
  assert.deepEqual(result, { value: "2", settled: false, samples: 2, stabilityMeasured: true });
});

test("fast capture is one fresh image and does not measure stability", async () => {
  let samples = 0;
  let waited = 0;
  const result = await captureSettledRaster({
    policy: "fast",
    capture: async () => {
      samples += 1;
      return "now";
    },
    bytes: (frame) => Buffer.from(frame),
    wait: async (ms) => {
      waited += ms;
    },
  });
  assert.deepEqual(result, {
    value: "now",
    settled: false,
    samples: 1,
    stabilityMeasured: false,
  });
  assert.equal(samples, 1);
  assert.equal(waited, 0);
});

test("sequence capture is one fresh image and does not use the stable loop", async () => {
  let samples = 0;
  let waited = 0;
  const result = await captureSettledRaster({
    policy: "sequence",
    capture: async () => {
      samples += 1;
      return "during";
    },
    bytes: (frame) => Buffer.from(frame),
    wait: async (ms) => {
      waited += ms;
    },
  });
  assert.deepEqual(result, {
    value: "during",
    settled: false,
    samples: 1,
    stabilityMeasured: false,
  });
  assert.equal(samples, 1);
  assert.equal(waited, 0);
});

test("omitted policy is Fast: one fresh image and does not measure stability", async () => {
  let samples = 0;
  let waited = 0;
  const result = await captureSettledRaster({
    capture: async () => {
      samples += 1;
      return String(samples);
    },
    bytes: (frame) => Buffer.from(frame),
    wait: async (ms) => {
      waited += ms;
    },
  });
  assert.deepEqual(result, {
    value: "1",
    settled: false,
    samples: 1,
    stabilityMeasured: false,
  });
  assert.equal(samples, 1);
  assert.equal(waited, 0);
});
