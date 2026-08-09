import assert from "node:assert/strict";
import test from "node:test";
import { devicesDoctorCheck, doctorFailureMessage, runDoctor } from "./doctor.js";

test("devices doctor accepts an iPad without any Android device", () => {
  const check = devicesDoctorCheck([
    {
      name: "iPad Pro 10.5",
      serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
      platform: "ios",
    },
  ]);
  assert.equal(check.ok, true);
  assert.match(check.message, /iPad Pro 10.5/);
  assert.match(check.message, /ios/);
  assert.doesNotMatch(check.message, /No Android device/);
});

test("devices doctor still reports Android USB debugging issues first", () => {
  const unauthorized = devicesDoctorCheck(
    [],
    [{ name: "Pixel 9", connectionState: "unauthorized" }],
  );
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.message, /authorization is pending/);

  const offline = devicesDoctorCheck([], [{ name: "Pixel 9", connectionState: "offline" }]);
  assert.equal(offline.ok, false);
  assert.match(offline.message, /offline/);
});

test("devices doctor mentions both platforms when nothing is connected", () => {
  const check = devicesDoctorCheck([]);
  assert.equal(check.ok, false);
  assert.match(check.message, /iPhone\/iPad/);
  assert.match(check.message, /Android/);
});

test("devices doctor stays ok when an iPad is listed beside stale ADB noise", () => {
  const check = devicesDoctorCheck(
    [
      {
        name: "iPad Pro 10.5",
        serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
        platform: "ios",
      },
    ],
    [{ name: "Pixel 9", connectionState: "unauthorized" }],
  );
  assert.equal(check.ok, true);
  assert.match(check.message, /iPad Pro 10.5/);
  assert.match(check.message, /authorization pending/);
});

test("runDoctor is healthy on an iOS-only Mac without adb", async () => {
  const listed = [
    {
      name: "iPad Pro 10.5",
      serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
      platform: "ios",
    },
  ];
  let listCalls = 0;
  const result = await runDoctor({
    node: async () => ({ id: "node", ok: true, message: "Node.js 22.23.2 (>= 22 required)" }),
    adbVersion: async () => ({
      id: "adb",
      ok: false,
      message: "adb not found on PATH (install Android platform-tools)",
    }),
    listDevices: async () => {
      listCalls += 1;
      return listed;
    },
    listAdbDevices: async () => [],
  });
  assert.equal(result.ok, true);
  assert.equal(listCalls, 1);
  assert.equal(result.checks.find((check) => check.id === "adb")?.ok, false);
  assert.equal(result.checks.find((check) => check.id === "devices")?.ok, true);
});

test("doctorFailureMessage summarizes failed checks for HTTP clients", () => {
  assert.equal(
    doctorFailureMessage({
      ok: false,
      checks: [
        { id: "node", ok: true, message: "Node.js 22" },
        {
          id: "devices",
          ok: false,
          message: "No device is visible. Connect an Android phone or an iPhone/iPad.",
        },
      ],
    }),
    "No device is visible. Connect an Android phone or an iPhone/iPad.",
  );
  assert.equal(doctorFailureMessage({ ok: true, checks: [] }), undefined);
});
