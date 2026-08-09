import assert from "node:assert/strict";
import test from "node:test";
import { inferDevicePlatformFromSerial } from "./target-context.js";
import { resolveJobDevicePlatform } from "./workspace.js";

test("explicit job platform wins over serial lookup", async () => {
  assert.equal(await resolveJobDevicePlatform("serial-ignored", "ios"), "ios");
  assert.equal(await resolveJobDevicePlatform("serial-ignored", "android"), "android");
  assert.equal(await resolveJobDevicePlatform(undefined), undefined);
  assert.equal(await resolveJobDevicePlatform("   "), undefined);
});

test("40-hex serials are iOS even when device list is unavailable", () => {
  assert.equal(inferDevicePlatformFromSerial("db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5"), "ios");
  assert.equal(inferDevicePlatformFromSerial("00008110-001A4D2E0E3A001E"), "ios");
  assert.equal(inferDevicePlatformFromSerial("emulator-5554"), "android");
  assert.equal(inferDevicePlatformFromSerial("pixel-9"), undefined);
});
