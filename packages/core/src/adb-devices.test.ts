import assert from "node:assert/strict";
import test from "node:test";
import { parseAdbDevices } from "./adb-devices.js";

test("keeps unauthorized physical Android devices visible", () => {
  assert.deepEqual(
    parseAdbDevices(`List of devices attached
RQCY104BG8X unauthorized usb:537993216X transport_id:6
`),
    [
      {
        serial: "RQCY104BG8X",
        name: "Android device",
        kind: "Physical device",
        connectionState: "unauthorized",
      },
    ],
  );
});

test("reads connected model names and distinguishes emulators", () => {
  assert.deepEqual(
    parseAdbDevices(`List of devices attached
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 transport_id:1
192.168.1.4:5555 offline product:panther model:Pixel_7 device:panther transport_id:2
`),
    [
      {
        serial: "emulator-5554",
        name: "sdk gphone64 arm64",
        kind: "Emulator",
        connectionState: "connected",
      },
      {
        serial: "192.168.1.4:5555",
        name: "Pixel 7",
        kind: "Physical device",
        connectionState: "offline",
      },
    ],
  );
});
