import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceInfo } from "./api-types";
import { interimDeviceScan, reconcileDeviceScan } from "./device-inventory";

function device(input: Partial<DeviceInfo> & Pick<DeviceInfo, "serial" | "platform">): DeviceInfo {
  return {
    id: input.serial,
    name: input.serial,
    kind: "Physical device",
    booted: true,
    ...input,
  } as DeviceInfo;
}

test("a transient empty fast phase does not blink a connected Android row", () => {
  const pixel = device({ serial: "pixel", platform: "android", osVersion: "16" });
  assert.deepEqual(interimDeviceScan([pixel], []), [pixel]);
});

test("the full scan restores Android when fast ADB is transiently empty", () => {
  const previous = device({ serial: "pixel", platform: "android", osVersion: "15" });
  const full = device({ serial: "pixel", platform: "android", osVersion: "16" });
  assert.deepEqual(reconcileDeviceScan([previous], [], [full]), [full]);
});

test("fast reachability wins while full discovery contributes metadata", () => {
  const fast = device({
    serial: "pixel",
    platform: "android",
    connectionState: "connected",
  });
  const full = device({ serial: "pixel", platform: "android", osVersion: "16" });
  const ios = device({ serial: "ipad", platform: "ios", osVersion: "18" });
  const result = reconcileDeviceScan([], [fast], [full, ios]);
  assert.equal(result[0]?.osVersion, "16");
  assert.equal(result[0]?.connectionState, "connected");
  assert.equal(result[1]?.serial, "ipad");
});
