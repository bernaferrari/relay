import assert from "node:assert/strict";
import test from "node:test";
import type { TargetSupervisorHealth } from "@relay/protocol";
import { targetHealthStatusModel } from "./target-health-status";

const health: TargetSupervisorHealth = {
  schemaVersion: 1,
  target: { id: "ipad", kind: "ios" },
  observedAt: 1,
  epochs: { target: 1, semanticSession: 2 },
  pixels: { state: "ready" },
  semantics: { state: "unavailable" },
  input: { state: "uncertain" },
  control: { state: "owned" },
  overall: "pixel-only",
  context: {},
  counters: {
    pixelCaptures: 1,
    semanticTraversals: 1,
    semanticTimeouts: 0,
    semanticWedges: 0,
    uncertainMutations: 1,
    reconciliations: 0,
    recoveryAttempts: 0,
    recoveryFailures: 0,
  },
  latency: {
    pixels: { count: 1 },
    semantics: { count: 1 },
    recovery: { count: 0 },
  },
  readiness: {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
    },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
  },
  events: [],
};

test("pixel-only health keeps live pixels distinct from labels and uncertain input", () => {
  const model = targetHealthStatusModel(health);
  assert.deepEqual(
    model.planes.map(({ id, value, tone }) => ({ id, value, tone })),
    [
      { id: "overall", value: "Pixels only", tone: "attention" },
      { id: "pixels", value: "Live", tone: "ready" },
      { id: "semantics", value: "Unavailable", tone: "attention" },
      { id: "input", value: "Needs review", tone: "attention" },
    ],
  );
  assert.doesNotMatch(model.planes.map((plane) => plane.value).join(" "), /disconnected/i);
});
