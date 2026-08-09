import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_FALLBACK_FRAME_INTERVAL_MS,
  LIVE_SNAPSHOT_INTERVAL_MS,
  liveInspectionPolicy,
} from "./live-inspection-policy";

test("PNG fallback never runs at video-frame cadence", () => {
  assert.ok(LIVE_FALLBACK_FRAME_INTERVAL_MS >= 2_000);
});

test("background accessibility inspection leaves room for physical-device input", () => {
  assert.ok(LIVE_SNAPSHOT_INTERVAL_MS >= LIVE_FALLBACK_FRAME_INTERVAL_MS * 2);
});

test("healthy video keeps accessibility inspection live without PNG polling", () => {
  assert.deepEqual(liveInspectionPolicy(true, false), {
    pollSnapshot: true,
    pollFallbackFrame: false,
  });
});

test("PNG fallback and accessibility inspection both poll after video failure", () => {
  assert.deepEqual(liveInspectionPolicy(true, true), {
    pollSnapshot: true,
    pollFallbackFrame: true,
  });
});

test("inactive device control does not poll either capture path", () => {
  assert.deepEqual(liveInspectionPolicy(false, true), {
    pollSnapshot: false,
    pollFallbackFrame: false,
  });
});

test("an exclusive physical-device recording suspends all inspection polling", () => {
  assert.deepEqual(liveInspectionPolicy(true, true, true), {
    pollSnapshot: false,
    pollFallbackFrame: false,
  });
});

test("pixels keep recovering when accessibility collection is off", () => {
  assert.deepEqual(liveInspectionPolicy(true, true, false, false), {
    pollSnapshot: false,
    pollFallbackFrame: true,
  });
});
