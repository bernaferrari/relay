import assert from "node:assert/strict";
import test from "node:test";
import {
  parseConnectedAppleHardwareDevices,
  reconcileAdapterAndroidReachability,
} from "./workspace-devices.js";

const physicalIpad = {
  connectionProperties: { tunnelState: "connected" },
  deviceProperties: {
    name: "iPad Pro 10.5",
    osVersionNumber: "17.7.11",
    developerModeStatus: "enabled",
    ddiServicesAvailable: true,
  },
  hardwareProperties: {
    platform: "iOS",
    reality: "physical",
    udid: "ipad-serial",
  },
};

test("keeps connected physical Apple devices even when CoreDevice omits bootState", () => {
  assert.deepEqual(parseConnectedAppleHardwareDevices([physicalIpad]), [
    {
      id: "ipad-serial",
      serial: "ipad-serial",
      name: "iPad Pro 10.5",
      kind: "Physical device",
      booted: true,
      platform: "ios",
      osVersion: "17.7.11",
      developerMode: "enabled",
      developerServicesAvailable: true,
    },
  ]);
});

test("drops paired Apple hardware whose control tunnel is unavailable", () => {
  assert.deepEqual(
    parseConnectedAppleHardwareDevices([
      {
        ...physicalIpad,
        connectionProperties: { tunnelState: "unavailable" },
        deviceProperties: {
          ...physicalIpad.deviceProperties,
          ddiServicesAvailable: false,
        },
      },
    ]),
    [],
  );
});

test("drops paired Apple hardware whose control tunnel is disconnected", () => {
  assert.deepEqual(
    parseConnectedAppleHardwareDevices([
      {
        ...physicalIpad,
        connectionProperties: { tunnelState: "disconnected" },
      },
    ]),
    [],
  );
});

test("a successful empty ADB sample removes a stale adapter phone", () => {
  const android = {
    id: "pixel",
    serial: "pixel",
    name: "Pixel",
    kind: "Physical device",
    booted: true,
    platform: "android" as const,
  };
  const ipad = {
    id: "ipad",
    serial: "ipad",
    name: "iPad",
    kind: "Physical device",
    booted: true,
    platform: "ios" as const,
  };
  assert.deepEqual(reconcileAdapterAndroidReachability([android, ipad], [], true), [ipad]);
  assert.deepEqual(reconcileAdapterAndroidReachability([android, ipad], [], false), [
    android,
    ipad,
  ]);
});
