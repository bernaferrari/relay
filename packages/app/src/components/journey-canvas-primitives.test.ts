import assert from "node:assert/strict";
import test from "node:test";
import { checkedTargetsLabel } from "./journey-canvas-primitives";

test("connection evidence names the one target that was actually checked", () => {
  assert.equal(
    checkedTargetsLabel([{ targetId: "device-1", targetName: "iPhone 16" }]),
    "Checked on iPhone 16",
  );
  assert.equal(checkedTargetsLabel([{ targetId: "device-2" }]), "Checked on device-2");
});

test("connection evidence never substitutes a target-set claim", () => {
  assert.equal(checkedTargetsLabel(undefined), "No target evidence recorded");
  assert.equal(
    checkedTargetsLabel([{ targetId: "iphone" }, { targetId: "ipad" }]),
    "Checked on 2 targets",
  );
});
