import assert from "node:assert/strict";
import test from "node:test";
import { IosSnapshotTimedOutError, type Device, type SnapshotNode } from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import {
  recordTargetPixelCapture,
  resetTargetRuntimeReadiness,
} from "./target-runtime-readiness.js";
import { captureSnapshot } from "./workspace-capture.js";

function iosSnapshotDevice(nodes: SnapshotNode[]): Device {
  return {
    capture: {
      snapshot: async () => ({ nodes }),
    },
  } as unknown as Device;
}

test.afterEach(() => resetTargetRuntimeReadiness());

test("a root-only iOS XCTest response is pixels-only rather than inspectable", async () => {
  const result = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "root-only-ipad" },
    () =>
      captureSnapshot({
        device: iosSnapshotDevice([
          {
            type: "Application",
            label: "Grok",
            rect: { x: 0, y: 0, width: 834, height: 1112 },
          },
        ]),
      }),
  );

  assert.equal(result.inspectable, false);
  assert.equal(result.source, "pixels-only");
  assert.equal(result.inspectionError, "Relay did not observe named accessibility controls.");
  assert.equal(result.readiness?.semanticControl.state, "unavailable");
  assert.equal(result.readiness?.semanticControl.freshness, "unproven");
});

test("a window-only iOS XCTest response is pixels-only rather than inspectable", async () => {
  const result = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "window-only-ipad" },
    () =>
      captureSnapshot({
        device: iosSnapshotDevice([
          {
            type: "Window",
            label: "Grok",
            rect: { x: 0, y: 0, width: 834, height: 1112 },
          },
        ]),
      }),
  );

  assert.equal(result.inspectable, false);
  assert.equal(result.source, "pixels-only");
  assert.equal(result.readiness?.semanticControl.state, "unavailable");
});

test("a slow iOS AX query publishes in-flight semantic readiness without disturbing pixels", async () => {
  const serial = "slow-ax-capture-ipad";
  const error = new IosSnapshotTimedOutError(8_000, 8_000);
  recordTargetPixelCapture({ serial, platform: "ios" }, { at: Date.now(), durationMs: 8 });

  const result = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
    captureSnapshot({
      device: {
        capture: {
          snapshot: async () => {
            throw error;
          },
        },
      } as unknown as Device,
    }),
  );

  assert.equal(result.inspectable, false);
  assert.equal(result.source, "pixels-only");
  assert.match(result.inspectionError ?? "", /still reading this screen/i);
  assert.doesNotMatch(result.inspectionError ?? "", /reconnect|XCTest session/i);
  assert.equal(result.readiness?.previewPixels.state, "proven");
  assert.equal(result.readiness?.evidenceCapture.state, "proven");
  assert.deepEqual(result.readiness?.semanticControl.reason, "probe-in-flight");
  assert.deepEqual(result.readiness?.semanticControl.lastError?.reason, "probe-in-flight");
  assert.equal("nextProbeAt" in (result.readiness?.semanticControl ?? {}), false);
  assert.deepEqual(result.iosSessionLifecycle?.outcome, "in-flight");
  assert.deepEqual(
    result.iosSessionLifecycle?.stages.find((stage) => stage.stage === "xctest-availability")
      ?.outcome,
    "skipped",
  );
});
