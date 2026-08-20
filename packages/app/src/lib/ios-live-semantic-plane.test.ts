import assert from "node:assert/strict";
import test from "node:test";
import { iosLiveSemanticPlane } from "./ios-live-semantic-plane";

test("only a current proven accessibility fact enables semantic overlays", () => {
  assert.deepEqual(
    iosLiveSemanticPlane({
      readiness: {
        mode: "accessibility",
        state: "proven",
        freshness: "current",
        proof: { at: 100, observedNodeCount: 4 },
      },
      now: 120,
    }),
    { state: "current", overlaysEnabled: true, permitsAutomaticProbe: true, proofAt: 100 },
  );
});

test("an input invalidates an otherwise-current tree until a later proof arrives", () => {
  const readiness = {
    mode: "accessibility" as const,
    state: "proven" as const,
    freshness: "current" as const,
    proof: { at: 100, observedNodeCount: 4 },
  };
  assert.equal(iosLiveSemanticPlane({ readiness, invalidatedAt: 101, now: 102 }).state, "stale");
  assert.equal(
    iosLiveSemanticPlane({ readiness: { ...readiness, proof: { at: 103 } }, invalidatedAt: 101 })
      .state,
    "current",
  );
});

test("a transient unavailable XCTest probe has a no-poll cooldown", () => {
  const readiness = {
    mode: "accessibility" as const,
    state: "unavailable" as const,
    freshness: "unproven" as const,
    nextProbeAt: 200,
  };
  assert.deepEqual(iosLiveSemanticPlane({ readiness, now: 150 }), {
    state: "cooldown",
    overlaysEnabled: false,
    permitsAutomaticProbe: false,
    nextProbeAt: 200,
  });
  assert.equal(iosLiveSemanticPlane({ readiness, now: 200 }).state, "unavailable");
});

test("an in-flight accessibility read never starts a competing automatic probe", () => {
  for (const readiness of [
    {
      mode: "accessibility" as const,
      state: "unavailable" as const,
      freshness: "unproven" as const,
      reason: "probe-in-flight" as const,
    },
    {
      mode: "accessibility" as const,
      state: "unavailable" as const,
      freshness: "unproven" as const,
      lastError: { at: 100, reason: "probe-in-flight" as const, durationMs: 8_000 },
    },
  ]) {
    assert.deepEqual(iosLiveSemanticPlane({ readiness, now: 200 }), {
      state: "in-flight",
      overlaysEnabled: false,
      permitsAutomaticProbe: false,
    });
  }
});

test("an iPad with no proof does not look like current control", () => {
  assert.deepEqual(iosLiveSemanticPlane({ now: 1 }), {
    state: "unproven",
    overlaysEnabled: false,
    permitsAutomaticProbe: true,
  });
});
