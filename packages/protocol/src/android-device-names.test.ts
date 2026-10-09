import assert from "node:assert/strict";
import { test } from "node:test";
import { androidDeviceDisplayName, readableDeviceName } from "./android-device-names.js";

test("names Samsung flagships from adb's model code in any spelling", () => {
  assert.equal(androidDeviceDisplayName("SM_S931B"), "Galaxy S25");
  assert.equal(androidDeviceDisplayName("SM S931B"), "Galaxy S25");
  assert.equal(androidDeviceDisplayName("SM-S938U"), "Galaxy S25 Ultra");
  assert.equal(androidDeviceDisplayName("SM-S926B"), "Galaxy S24+");
  assert.equal(androidDeviceDisplayName("SM-S937B"), "Galaxy S25 Edge");
  assert.equal(androidDeviceDisplayName("SM-S721B"), "Galaxy S24 FE");
  assert.equal(androidDeviceDisplayName("SM-G998B"), "Galaxy S21 Ultra");
});

test("names foldables and mid-range Galaxy phones", () => {
  assert.equal(androidDeviceDisplayName("SM-F956B"), "Galaxy Z Fold6");
  assert.equal(androidDeviceDisplayName("SM_F741B"), "Galaxy Z Flip6");
  assert.equal(androidDeviceDisplayName("SM-A546B"), "Galaxy A54");
  assert.equal(androidDeviceDisplayName("SM-M156B"), "Galaxy M15");
});

test("keeps unknown codes real and readable instead of guessing", () => {
  assert.equal(androidDeviceDisplayName("SM_X910"), "Samsung SM-X910");
  assert.equal(androidDeviceDisplayName("SM-S948B"), "Samsung SM-S948B");
  assert.equal(androidDeviceDisplayName("Pixel_9_Pro_XL"), "Pixel 9 Pro XL");
  assert.equal(androidDeviceDisplayName("Pixel 9"), "Pixel 9");
});

test("rewrites only stored Samsung codes", () => {
  assert.equal(readableDeviceName("SM S931B"), "Galaxy S25");
  assert.equal(readableDeviceName("chrome_profile"), "chrome_profile");
  assert.equal(readableDeviceName("iPad Pro 10.5"), "iPad Pro 10.5");
});
