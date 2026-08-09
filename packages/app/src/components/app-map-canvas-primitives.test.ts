import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import { checkedTargetsLabel, connectionStatusLabel } from "../lib/connection-presentation";

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
