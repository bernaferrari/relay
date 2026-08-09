import assert from "node:assert/strict";
import test from "node:test";
import { appMapDeviceStatus } from "./device-status-label";

test("device status tells one authoritative story", () => {
  assert.deepEqual(
    appMapDeviceStatus({
      readiness: { kind: "ready" },
      deviceSelected: true,
      serverOnline: true,
      controlIssue: "This device is being controlled in another Relay window.",
      controlTakeoverAvailable: true,
    }),
    {
      label: "View only",
      kind: "view-only",
      detail: "This device is being controlled in another Relay window.",
    },
  );
  assert.deepEqual(
    appMapDeviceStatus({
      readiness: { kind: "choose-device" },
      deviceSelected: false,
      serverOnline: true,
      discovering: true,
    }),
    { label: "Looking for devices", kind: "progress" },
  );
  assert.deepEqual(
    appMapDeviceStatus({
      readiness: { kind: "screen-preparing", title: "Connecting", detail: "Wait" },
      deviceSelected: true,
      serverOnline: true,
    }),
    { label: "Starting live view", kind: "progress" },
  );
  assert.deepEqual(
    appMapDeviceStatus({
      readiness: { kind: "capture-error", title: "Unavailable", detail: "Retry" },
      deviceSelected: true,
      serverOnline: true,
    }),
    { label: "Screen unavailable", kind: "attention" },
  );
  assert.deepEqual(
    appMapDeviceStatus({
      readiness: { kind: "capture-error", title: "Unavailable", detail: "Retry" },
      deviceSelected: true,
      serverOnline: true,
      recording: true,
    }),
    { label: "Recording", kind: "recording" },
  );
});
