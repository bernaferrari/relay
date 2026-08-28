import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "./operations.js";
import type { TargetSupervisorHealth } from "./target-supervisor.js";

function readiness() {
  return {
    previewPixels: {
      mode: "pixels" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof: { at: 10, durationMs: 4 },
    },
    semanticControl: {
      mode: "accessibility" as const,
      state: "unavailable" as const,
      freshness: "unproven" as const,
      reason: "developer-services-unavailable" as const,
    },
    evidenceCapture: {
      mode: "evidence" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof: { at: 10, durationMs: 4 },
    },
  };
}

function health(): TargetSupervisorHealth {
  return {
    schemaVersion: 1,
    target: { id: "ipad-health", kind: "ios" },
    observedAt: 10,
    epochs: { target: 1, semanticSession: 1 },
    pixels: { state: "ready", lastCapturedAt: 10 },
    semantics: { state: "unavailable", lastError: "Runner is unavailable." },
    input: { state: "ready" },
    control: { state: "available" },
    overall: "pixel-only",
    context: { foregroundApp: "com.example.app" },
    counters: {
      pixelCaptures: 1,
      semanticTraversals: 1,
      semanticTimeouts: 0,
      semanticWedges: 0,
      uncertainMutations: 0,
      reconciliations: 0,
      recoveryAttempts: 0,
      recoveryFailures: 0,
    },
    latency: {
      pixels: { count: 1, averageMs: 4, maximumMs: 4 },
      semantics: { count: 0 },
      recovery: { count: 0 },
    },
    readiness: readiness(),
    events: [
      {
        sequence: 1,
        at: 10,
        code: "PIXELS_CAPTURED",
        message: "Pixel evidence is current.",
      },
    ],
  };
}

test("target.health.get validates one bounded public health projection", () => {
  const definition = operationDefinition("target.health.get");
  const output = { health: health() };
  assert.deepEqual(definition.output.parse(output), output);
  assert.equal(definition.minimumRole, "viewer");
  assert.equal(definition.lease, "none");
  assert.equal(definition.mode, "query");
});

test("target.health.get rejects an unbounded diagnostic history", () => {
  const value = health();
  value.events = Array.from({ length: 129 }, (_, index) => ({
    sequence: index + 1,
    at: index,
    code: "PIXELS_CAPTURED" as const,
    message: "bounded",
  }));
  assert.throws(
    () => operationDefinition("target.health.get").output.parse({ health: value }),
    /at most 128/u,
  );
});
