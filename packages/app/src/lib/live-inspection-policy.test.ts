import assert from "node:assert/strict";
import test from "node:test";
import { liveInspectionPolicy } from "./live-inspection-policy";

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
