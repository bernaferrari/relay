import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import { checkedTargetsLabel, connectionStatusLabel } from "../lib/connection-presentation";

test("connection evidence names the one target that was actually checked", () => {
  assert.equal(
    checkedTargetsLabel([{ targetId: "device-1", targetName: "iPhone 16" }]),
    "Checked on iPhone 16",
  );
  assert.equal(checkedTargetsLabel([{ targetId: "device-2" }]), "Checked on device-2");
});

test("connection evidence never substitutes a target-set claim", () => {
  assert.equal(checkedTargetsLabel(undefined), "Not replayed on a target yet");
  assert.equal(checkedTargetsLabel(undefined, "verified"), "Last replay reached this screen");
  assert.equal(checkedTargetsLabel(undefined, "failed"), "Latest replay changed");
  assert.equal(
    checkedTargetsLabel([{ targetId: "iphone" }, { targetId: "ipad" }]),
    "Checked on 2 targets",
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
  assert.equal(connectionStatusLabel(connection()), "Not verified");
  assert.equal(connectionStatusLabel(connection({ takeId: "take-1" })), "Captured");
  assert.equal(
    connectionStatusLabel(
      connection({ review: { status: "verified", updatedAt: 2, verifiedAt: 2 } }),
    ),
    "Verified",
  );
});
