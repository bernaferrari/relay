import assert from "node:assert/strict";
import test from "node:test";
import type { Device, SnapshotNode } from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import { resetTargetRuntimeReadiness } from "./target-runtime-readiness.js";
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
