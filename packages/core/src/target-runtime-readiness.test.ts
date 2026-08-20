import assert from "node:assert/strict";
import test from "node:test";
import {
  IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS,
  IOS_SEMANTIC_PROBE_MAX_COOLDOWN_MS,
  TARGET_RUNTIME_READINESS_TTL_MS,
  hasUsableSemanticAccessibility,
  invalidateTargetSemanticControl,
  recordTargetPixelCapture,
  recordTargetSemanticSnapshot,
  resetTargetRuntimeReadiness,
  targetRuntimeReadiness,
} from "./target-runtime-readiness.js";

const ipad = {
  serial: "ipad-1",
  platform: "ios" as const,
  kind: "Physical device",
  booted: true,
  developerMode: "enabled" as const,
  developerServicesAvailable: true,
};

test.afterEach(() => resetTargetRuntimeReadiness());

test("an attached iPad begins unproven instead of claiming XCTest control", () => {
  assert.deepEqual(targetRuntimeReadiness(ipad, 1), {
    previewPixels: {
      mode: "pixels",
      state: "unproven",
      freshness: "unproven",
      reason: "not-yet-proven",
    },
    semanticControl: {
      mode: "accessibility",
      state: "unproven",
      freshness: "unproven",
      reason: "not-yet-proven",
    },
    evidenceCapture: {
      mode: "evidence",
      state: "unproven",
      freshness: "unproven",
      reason: "not-yet-proven",
    },
  });
});

test("a stopped simulator is unavailable without attempting a target probe", () => {
  const readiness = targetRuntimeReadiness(
    { serial: "sim-1", platform: "ios", kind: "iOS Simulator", booted: false },
    1,
  );
  assert.deepEqual(readiness, {
    previewPixels: {
      mode: "pixels",
      state: "unavailable",
      freshness: "unproven",
      reason: "target-stopped",
    },
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
      reason: "target-stopped",
    },
    evidenceCapture: {
      mode: "evidence",
      state: "unavailable",
      freshness: "unproven",
      reason: "target-stopped",
    },
  });
});

test("Apple setup can block semantics without hiding pixel preview and evidence", () => {
  const readiness = targetRuntimeReadiness(
    { ...ipad, developerMode: "disabled", developerServicesAvailable: false },
    1,
  );
  assert.deepEqual(readiness.previewPixels, {
    mode: "pixels",
    state: "unproven",
    freshness: "unproven",
    reason: "not-yet-proven",
  });
  assert.deepEqual(readiness.evidenceCapture, {
    mode: "evidence",
    state: "unproven",
    freshness: "unproven",
    reason: "not-yet-proven",
  });
  assert.deepEqual(readiness.semanticControl, {
    mode: "accessibility",
    state: "unavailable",
    freshness: "unproven",
    reason: "developer-mode-disabled",
  });
});

test("pixel and semantic proofs stay independent and retain timing", () => {
  recordTargetPixelCapture(ipad, { at: 10, durationMs: 640 });
  let readiness = targetRuntimeReadiness(ipad, 11);
  assert.equal(readiness.previewPixels.state, "proven");
  assert.equal(readiness.evidenceCapture.state, "proven");
  assert.equal(readiness.semanticControl.state, "unproven");

  recordTargetSemanticSnapshot(ipad, {
    inspectable: true,
    at: 12,
    durationMs: 480,
    nodes: [
      {
        type: "StaticText",
        label: "Settings",
        rect: { x: 80, y: 80, width: 120, height: 30 },
      },
    ],
  });
  readiness = targetRuntimeReadiness(ipad, 13);
  assert.deepEqual(readiness.previewPixels, {
    mode: "pixels",
    state: "proven",
    freshness: "current",
    proof: { at: 10, durationMs: 640 },
  });
  assert.deepEqual(readiness.semanticControl, {
    mode: "accessibility",
    state: "proven",
    freshness: "current",
    proof: { at: 12, observedNodeCount: 1, durationMs: 480 },
  });
});

test("an empty or root-only accessibility response is explicitly not semantic control", () => {
  recordTargetSemanticSnapshot(ipad, {
    inspectable: true,
    at: 10,
    nodes: [
      {
        type: "Application",
        label: "Grok",
        rect: { x: 0, y: 0, width: 834, height: 1112 },
      },
    ],
  });
  assert.deepEqual(targetRuntimeReadiness(ipad, 11).semanticControl, {
    mode: "accessibility",
    state: "unavailable",
    freshness: "unproven",
    reason: "probe-failed",
    lastError: { at: 10, reason: "probe-failed", observedNodeCount: 1 },
    nextProbeAt: 10 + IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS,
  });
  assert.equal(
    hasUsableSemanticAccessibility([
      { type: "Window", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    ]),
    false,
  );
});

test("repeated iOS semantic failures expose bounded backoff instead of inviting a poll loop", () => {
  const failedSnapshot = (at: number) =>
    recordTargetSemanticSnapshot(ipad, { inspectable: false, nodes: [], at });
  failedSnapshot(10);
  let readiness = targetRuntimeReadiness(ipad, 11).semanticControl;
  assert.equal(readiness.nextProbeAt, 10 + IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS);

  failedSnapshot(readiness.nextProbeAt!);
  readiness = targetRuntimeReadiness(ipad, readiness.nextProbeAt! + 1).semanticControl;
  assert.equal(
    readiness.nextProbeAt,
    10 + IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS + IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS * 2,
  );

  failedSnapshot(readiness.nextProbeAt!);
  readiness = targetRuntimeReadiness(ipad, readiness.nextProbeAt! + 1).semanticControl;
  assert.equal(
    readiness.nextProbeAt,
    10 +
      IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS +
      IOS_SEMANTIC_PROBE_INITIAL_COOLDOWN_MS * 2 +
      IOS_SEMANTIC_PROBE_MAX_COOLDOWN_MS,
  );
});

test("old proofs downgrade to unproven rather than becoming stale green readiness", () => {
  recordTargetPixelCapture(ipad, { at: 10 });
  const readiness = targetRuntimeReadiness(ipad, 10 + TARGET_RUNTIME_READINESS_TTL_MS + 1);
  assert.deepEqual(readiness.previewPixels, {
    mode: "pixels",
    state: "unproven",
    freshness: "unproven",
    reason: "not-yet-proven",
  });
  assert.deepEqual(readiness.evidenceCapture, {
    mode: "evidence",
    state: "unproven",
    freshness: "unproven",
    reason: "not-yet-proven",
  });
});

test("a newer input or pixel frame makes the semantic overlay stale without invalidating pixels", () => {
  recordTargetPixelCapture(ipad, { at: 1, visualFingerprint: "frame-a" });
  recordTargetSemanticSnapshot(ipad, {
    inspectable: true,
    at: 2,
    nodes: [
      {
        type: "Button",
        label: "Settings",
        rect: { x: 80, y: 80, width: 120, height: 44 },
      },
    ],
  });
  invalidateTargetSemanticControl(ipad, "input-changed", 3);
  let readiness = targetRuntimeReadiness(ipad, 4);
  assert.deepEqual(readiness.semanticControl, {
    mode: "accessibility",
    state: "proven",
    freshness: "stale",
    proof: { at: 2, observedNodeCount: 1 },
    invalidated: { at: 3, reason: "input-changed" },
  });
  assert.equal(readiness.previewPixels.freshness, "current");

  recordTargetPixelCapture(ipad, { at: 5, visualFingerprint: "frame-b" });
  readiness = targetRuntimeReadiness(ipad, 6);
  assert.deepEqual(readiness.semanticControl.invalidated, {
    at: 5,
    reason: "visual-changed",
  });

  recordTargetSemanticSnapshot(ipad, {
    inspectable: true,
    at: 7,
    nodes: [
      {
        type: "Button",
        identifier: "settings.done",
        label: "Done",
        rect: { x: 720, y: 80, width: 70, height: 44 },
      },
    ],
  });
  readiness = targetRuntimeReadiness(ipad, 8);
  assert.deepEqual(readiness.semanticControl, {
    mode: "accessibility",
    state: "proven",
    freshness: "current",
    proof: { at: 7, observedNodeCount: 1 },
  });
});

test("an expired visual fingerprint does not invalidate a new semantic session", () => {
  recordTargetPixelCapture(ipad, { at: 1, visualFingerprint: "old-frame" });
  targetRuntimeReadiness(ipad, 1 + TARGET_RUNTIME_READINESS_TTL_MS + 1);
  recordTargetSemanticSnapshot(ipad, {
    inspectable: true,
    at: TARGET_RUNTIME_READINESS_TTL_MS + 2,
    nodes: [
      {
        type: "Button",
        label: "Continue",
        rect: { x: 80, y: 80, width: 120, height: 44 },
      },
    ],
  });
  recordTargetPixelCapture(ipad, {
    at: TARGET_RUNTIME_READINESS_TTL_MS + 3,
    visualFingerprint: "new-frame",
  });
  assert.equal(
    targetRuntimeReadiness(ipad, TARGET_RUNTIME_READINESS_TTL_MS + 4).semanticControl.freshness,
    "current",
  );
});
