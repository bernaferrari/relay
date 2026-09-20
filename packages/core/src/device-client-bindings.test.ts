import assert from "node:assert/strict";
import test from "node:test";
import { buildDeviceTransport } from "./device-client-bindings.js";

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
