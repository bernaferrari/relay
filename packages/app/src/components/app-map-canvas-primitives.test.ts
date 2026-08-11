import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import {
  checkedTargetsLabel,
  connectionLabelMode,
  connectionStatusLabel,
} from "../lib/connection-presentation";

test("connection evidence names the one target that was actually checked", () => {
  assert.equal(
    checkedTargetsLabel([{ targetId: "device-1", targetName: "iPhone 16" }]),
    "Tried on iPhone 16",
  );
  assert.equal(checkedTargetsLabel([{ targetId: "device-2" }]), "Tried on this device");
});

test("connection evidence never substitutes a target-set claim", () => {
  assert.equal(checkedTargetsLabel(undefined), "Not tried on a device yet");
  assert.equal(checkedTargetsLabel(undefined, "verified"), "Last try reached this screen");
  assert.equal(checkedTargetsLabel(undefined, "failed"), "Last try didn’t match");
  assert.equal(
    checkedTargetsLabel([{ targetId: "iphone" }, { targetId: "ipad" }]),
    "Tried on 2 devices",
  );
});

const connection = (overrides: Partial<CanvasConnection> = {}): CanvasConnection => ({
  id: "checkout",
  fromScreenId: "cart",
  toScreenId: "checkout",
  stepIds: [],
  state: "recorded",
  source: "authored",
  mode: "interaction",
  kind: "forward",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

test("connection status never calls executable or untested work verified", () => {
  assert.equal(connectionStatusLabel(connection()), "Not tried yet");
  assert.equal(connectionStatusLabel(connection({ takeId: "take-1" })), "Ready to try");
  assert.equal(
    connectionStatusLabel(
      connection({ review: { status: "verified", updatedAt: 2, verifiedAt: 2 } }),
    ),
    "Works",
  );
});

test("ordinary taps stay quiet while meaningful gestures keep their labels", () => {
  assert.equal(
    connectionLabelMode(connection({ stepIds: ["tap"] }), [
      { id: "tap", kind: "tap", target: { label: "Settings" } },
      { id: "pause", kind: "sleep", ms: 1_200 },
    ]),
    "hidden",
  );
  assert.equal(
    connectionLabelMode(connection({ stepIds: ["double"] }), [
      { id: "double", kind: "tap", gesture: "multi", tapCount: 2, target: { label: "Photo" } },
    ]),
    "always",
  );
  assert.equal(
    connectionLabelMode(connection({ stepIds: ["swipe"] }), [
      { id: "swipe", kind: "swipe", from: { x: 10, y: 80 }, to: { x: 10, y: 20 } },
    ]),
    "always",
  );
  assert.equal(
    connectionLabelMode(connection({ stepIds: ["tap", "type"] }), [
      { id: "tap", kind: "tap", target: { label: "Name" } },
      { id: "type", kind: "type", target: { label: "Name" }, text: "Relay" },
    ]),
    "always",
  );
  assert.equal(connectionLabelMode(connection({ state: "needs-recording" }), []), "hidden");
});
