import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectVisualFrame,
  visualFrameFingerprint,
  type VisualFrameSample,
} from "./visual-frame-signal.js";

function frame(width: number, height: number, value = 0): VisualFrameSample {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

test("a stable visual frame retains its accepted fingerprint", () => {
  const first = frame(10, 10, 10);
  const initial = inspectVisualFrame({}, first, 0, { minIntervalMs: 1 });
  assert.equal(initial.signal?.fingerprint, visualFrameFingerprint(first));

  const stable = inspectVisualFrame(initial.state, frame(10, 10, 10), 1, { minIntervalMs: 1 });
  assert.equal(stable.sampled, true);
  assert.equal(stable.signal, undefined);
  assert.equal(stable.state.fingerprint, initial.state.fingerprint);
});

test("a material visual change produces one new transient fingerprint", () => {
  const initial = inspectVisualFrame({}, frame(10, 10, 0), 0, { minIntervalMs: 1 });
  const changedFrame = frame(10, 10, 255);
  const changed = inspectVisualFrame(initial.state, changedFrame, 1, { minIntervalMs: 1 });

  assert.equal(changed.signal?.previousFingerprint, initial.state.fingerprint);
  assert.equal(changed.signal?.fingerprint, visualFrameFingerprint(changedFrame));
  assert.equal(changed.signal?.changedRatio, 1);
  assert.ok((changed.signal?.meanDelta ?? 0) > 700);
});

test("small localized motion remains below the material-change threshold", () => {
  const initial = inspectVisualFrame({}, frame(10, 10, 0), 0, {
    minIntervalMs: 1,
    minChangedRatio: 0.2,
  });
  const noisy = frame(10, 10, 0);
  for (let pixel = 0; pixel < 19; pixel += 1) {
    noisy.data[pixel * 4] = 255;
  }

  const result = inspectVisualFrame(initial.state, noisy, 1, {
    minIntervalMs: 1,
    minChangedRatio: 0.2,
  });
  assert.equal(result.signal, undefined);
  assert.equal(result.state.fingerprint, initial.state.fingerprint);
});

test("small full-frame compression noise remains below the per-pixel threshold", () => {
  const initial = inspectVisualFrame({}, frame(10, 10, 20), 0, { minIntervalMs: 1 });
  // RGB distance is 30, below the default per-pixel distance of 42.
  const compressionNoise = inspectVisualFrame(initial.state, frame(10, 10, 30), 1, {
    minIntervalMs: 1,
  });
  assert.equal(compressionNoise.signal, undefined);
  assert.equal(compressionNoise.state.fingerprint, initial.state.fingerprint);
});

test("sampling cadence skips decoded frames before allocating or comparing pixels", () => {
  const initial = inspectVisualFrame({}, frame(10, 10, 0), 100, { minIntervalMs: 400 });
  const tooSoon = inspectVisualFrame(initial.state, frame(10, 10, 255), 499, {
    minIntervalMs: 400,
  });
  assert.equal(tooSoon.sampled, false);
  assert.equal(tooSoon.state, initial.state);

  const due = inspectVisualFrame(initial.state, frame(10, 10, 255), 500, { minIntervalMs: 400 });
  assert.equal(due.sampled, true);
  assert.ok(due.signal);
});
