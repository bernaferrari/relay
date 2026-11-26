import assert from "node:assert/strict";
import test from "node:test";
import {
  identityIgnoreRegionsForObservation,
  type RuntimeIdentityIgnoreRegion,
} from "./recipe-identity-ignore-scope.js";
import { recipeScreenIdentityOptions } from "./recipe-runner-context.js";

const clock: RuntimeIdentityIgnoreRegion = {
  name: "clock",
  x: 0.8,
  y: 0,
  width: 0.2,
  height: 0.05,
  frameIndex: 0,
};

test("mask on step A does not apply to step B", () => {
  const first = identityIgnoreRegionsForObservation({
    regions: [clock],
    observation: { frameIndex: 0, stepId: "chat", checkpointId: "chat", screenId: "chat" },
  });
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0]?.name, "clock");
  assert.equal(first.next[0]?.stepId, "chat");

  const later = identityIgnoreRegionsForObservation({
    regions: first.next,
    observation: {
      frameIndex: 1,
      stepId: "settings",
      checkpointId: "settings",
      screenId: "settings",
    },
  });
  assert.equal(later.applied.length, 0);
  assert.equal(later.next[0]?.stepId, "chat");
});

test("identity-ignore on checkpoint N does not apply to N+1 unless re-authored", () => {
  const bound = identityIgnoreRegionsForObservation({
    regions: [clock],
    extra: [],
    observation: { frameIndex: 0, checkpointId: "home-chrome" },
  });
  const nextCheckpoint = identityIgnoreRegionsForObservation({
    regions: bound.next,
    extra: [{ name: "status bar", x: 0, y: 0, width: 1, height: 0.04 }],
    observation: { frameIndex: 1, checkpointId: "settings" },
  });
  assert.equal(nextCheckpoint.applied.length, 1);
  assert.equal(nextCheckpoint.applied[0]?.name, "status bar");
  assert.equal(
    nextCheckpoint.applied.some((region) => region.name === "clock"),
    false,
  );
});

test("unbound identity-ignore stays off a later frame epoch", () => {
  const laterFrame = identityIgnoreRegionsForObservation({
    regions: [clock],
    observation: { frameIndex: 1 },
  });
  assert.equal(laterFrame.applied.length, 0);
  assert.equal(laterFrame.next.length, 1);
});

test("recipe identity options bind a chat ignore so Settings proofs stay unmasked", () => {
  const runtime = { identityIgnoreRegions: [{ ...clock }] };
  const chat = recipeScreenIdentityOptions({ log: () => undefined, runtime }, undefined, {
    frameIndex: 0,
    stepId: "chat",
    screenId: "chat",
    checkpointId: "chat",
  });
  assert.equal(chat.ignoreRegions.length, 1);
  assert.equal(runtime.identityIgnoreRegions[0]?.stepId, "chat");

  const settings = recipeScreenIdentityOptions({ log: () => undefined, runtime }, undefined, {
    frameIndex: 1,
    stepId: "settings",
    screenId: "settings",
    checkpointId: "settings",
  });
  assert.equal(settings.ignoreRegions.length, 0);
});
