import assert from "node:assert/strict";
import test from "node:test";
import { buildDeviceTransport } from "./device-client-bindings.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";
import type { SnapshotNode } from "./device-capabilities.js";
import { normalizeIosSnapshotNodes } from "./ios-geometry.js";
import type { TargetContext } from "./target-context.js";

function sdkClient(snapshot: (...args: unknown[]) => Promise<unknown>) {
  return {
    apps: {},
    capture: { snapshot },
    interactions: {},
    command: {},
    devices: {},
    settings: {},
    recording: {},
    observability: {},
  };
}

const ios: TargetContext = { kind: "device", platform: "ios", serial: "ipad-sdk" };
const logicalNodes: SnapshotNode[] = [
  { depth: 0, type: "Application", rect: { x: 0, y: 0, width: 1112, height: 834 } },
  { depth: 1, type: "Window", rect: { x: 0, y: 0, width: 1112, height: 834 } },
  {
    type: "Button",
    identifier: "PopoverDismissRegion",
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  },
];

test("current iOS SDK snapshots retain their logical landscape frames for default and raw reads", async () => {
  for (const raw of [undefined, false, true]) {
    let calls = 0;
    const options = raw === undefined ? {} : { raw };
    const result = {
      nodes: logicalNodes,
      viewport: { width: 1112, height: 834 },
      truncated: false,
    };
    const native = sdkClient(async (received) => {
      calls += 1;
      assert.equal(received, options);
      return result;
    });
    const snapshot = native.capture.snapshot;
    const received = await buildDeviceTransport(native as never, ios).capture.snapshot(options);
    assert.deepEqual(
      normalizeIosSnapshotNodes(received.nodes!).map(({ rect }) => rect),
      logicalNodes.map(({ rect }) => rect),
    );
    assert.ok(received.nodes!.every(({ logicalCoordinates }) => logicalCoordinates === true));
    assert.deepEqual({ ...received, nodes: logicalNodes }, result);
    assert.equal(calls, 1);
    assert.equal(native.capture.snapshot, snapshot);
    assert.ok(logicalNodes.every(({ logicalCoordinates }) => logicalCoordinates === undefined));
    assert.notEqual(received.nodes, logicalNodes);
  }
});

test("non-iOS SDK and generic observation adapters preserve their snapshot payloads", async () => {
  const result = { nodes: logicalNodes };
  const contexts: TargetContext[] = [
    { kind: "device", platform: "android", serial: "android-sdk" },
    { kind: "browser", platform: "browser", targetId: "browser-sdk" },
    { kind: "cloud", platform: "ios", provider: "example", sessionId: "cloud-sdk" },
  ];
  for (const context of contexts) {
    const native = sdkClient(async () => result);
    assert.equal(await buildDeviceTransport(native as never, context).capture.snapshot(), result);
  }
  const legacy = createDeviceObservationFacade(sdkClient(async () => result));
  assert.equal(await legacy.capture.snapshot(), result);
  assert.ok(result.nodes.every(({ logicalCoordinates }) => logicalCoordinates === undefined));
});

test("an iOS SDK response without a node array retains its original shape", async () => {
  const result = { nodeCount: 3, refs: ["e1", "e2"] };
  const native = sdkClient(async () => result);
  assert.equal(await buildDeviceTransport(native as never, ios).capture.snapshot(), result);
});

test("wrapping an SDK client does not mutate nested methods on the original object", () => {
  const open = async () => ({ appBundleId: "com.apple.Preferences" });
  const snapshot = async () => ({ nodes: [] });
  const native = {
    apps: { open },
    capture: { snapshot },
    interactions: {},
    command: {},
    devices: {},
    settings: { update: async () => ({}) },
    recording: {},
    observability: {},
  };
  const wrapped = buildDeviceTransport(native as never, {
    kind: "device",
    platform: "ios",
    serial: "D2625C92-964D-4326-8C83-0A4B9B06431D",
  });
  assert.equal(native.apps.open, open);
  assert.equal(native.capture.snapshot, snapshot);
  assert.equal(typeof wrapped.capture.snapshot, "function");
});
