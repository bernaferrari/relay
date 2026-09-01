import assert from "node:assert/strict";
import test from "node:test";
import {
  browserDeviceTelemetrySchema,
  summarizeBrowserDeviceTelemetry,
} from "./browser-device-telemetry.js";

test("Browser Device telemetry reports bounded latency, FPS, and budget status", () => {
  const telemetry = summarizeBrowserDeviceTelemetry({
    frameCaptureMs: [40, 80, 300],
    interactionMs: [20, 40, 60],
    frameTimesMs: [0, 100, 200, 300],
    droppedFrames: 2,
  });

  assert.deepEqual(telemetry.frameCapture, {
    samples: 3,
    p50Ms: 80,
    p95Ms: 300,
    maxMs: 300,
  });
  assert.equal(telemetry.observedFps, 10);
  assert.deepEqual(telemetry.budgets, {
    frameCapture: "exceeded",
    interaction: "within",
    observedFps: "within",
  });
  assert.deepEqual(browserDeviceTelemetrySchema.parse(telemetry), telemetry);
});

test("Browser Device telemetry stays explicitly unmeasured without enough samples", () => {
  const telemetry = summarizeBrowserDeviceTelemetry({
    frameCaptureMs: [],
    interactionMs: [],
    frameTimesMs: [10],
  });

  assert.equal(telemetry.observedFps, undefined);
  assert.deepEqual(telemetry.frameCapture, { samples: 0 });
  assert.deepEqual(telemetry.budgets, {
    frameCapture: "unmeasured",
    interaction: "unmeasured",
    observedFps: "unmeasured",
  });
  assert.doesNotThrow(() => browserDeviceTelemetrySchema.parse(telemetry));
});
