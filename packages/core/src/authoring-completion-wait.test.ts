import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringObservation } from "@relay/protocol";
import { inferredAuthoringCompletionWait } from "./authoring-completion-wait.js";

function observation(busy: boolean): AuthoringObservation {
  const capturedAt = busy ? 1 : 2;
  return {
    id: String(capturedAt),
    capturedAt,
    evidenceIds: [],
    foregroundApp: "test.app",
    screen: {
      id: String(capturedAt),
      fingerprint: String(capturedAt),
      capturedAt,
      source: "recording",
    },
    proof: {
      schemaVersion: 1,
      captureOrder: "concurrent",
      pixels: { status: "captured", capturedAt, fingerprint: String(capturedAt) },
      semantics: { status: "current", capturedAt, fingerprint: String(capturedAt) },
    },
    nodes: [
      {
        index: 1,
        label: "Explain why sailboats need a keel.",
        bundleId: "test.app",
        type: "android.widget.TextView",
        rect: { x: 20, y: 100, width: 300, height: 60 },
      },
      {
        index: 2,
        label: busy ? "Stop message" : "Copy message",
        bundleId: "test.app",
        type: "android.widget.Button",
        hittable: true,
        enabled: true,
        rect: { x: 20, y: 200, width: 60, height: 60 },
      },
    ],
  };
}

test("observed busy-to-result transition learns bounded conditions, not elapsed review time", () => {
  const before = observation(true),
    after = observation(false);
  after.capturedAt = 3_600_000;
  assert.deepEqual(inferredAuthoringCompletionWait(before, after), {
    kind: "steps",
    label: "Wait for result · Copy message",
    steps: [
      { kind: "expect", target: { label: "Stop message" }, condition: "gone", timeoutMs: 300_000 },
      { kind: "wait-for", target: { label: "Copy message" }, timeoutMs: 300_000 },
    ],
  });
});

test("unchanged pixels, stalled work, and cancellation alone do not establish completion", () => {
  const before = observation(true),
    after = observation(false);
  after.nodes = after.nodes!.slice(0, 1);
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.nodes!.push(...before.nodes!.slice(1));
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
});

test("foreign conversations, stale semantics, and ambiguous result controls teach nothing", () => {
  const before = observation(true),
    after = observation(false);
  after.nodes![0]!.label = "A different conversation with another prompt.";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.nodes![0]!.label = before.nodes![0]!.label;
  after.foregroundApp = "another.app";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.foregroundApp = before.foregroundApp;
  after.proof!.semantics.status = "unavailable";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.proof!.semantics.status = "current";
  after.nodes!.push({
    ...after.nodes![1],
    index: 3,
    rect: { x: 150, y: 200, width: 60, height: 60 },
  });
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
});
