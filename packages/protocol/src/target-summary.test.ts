import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTargetOperationResult } from "./target-summary.js";

test("device command summaries hide stopped simulators without hiding physical hardware", () => {
  const result = summarizeTargetOperationResult("target.devices.list", {
    devices: [
      {
        id: "phone",
        serial: "phone",
        name: "Physical phone",
        kind: "Physical device",
        booted: false,
        platform: "android",
      },
      {
        id: "running-sim",
        serial: "running-sim",
        name: "Running simulator",
        kind: "simulator",
        booted: true,
        platform: "ios",
      },
      {
        id: "stopped-sim",
        serial: "stopped-sim",
        name: "Stopped simulator",
        kind: "simulator",
        booted: false,
        platform: "ios",
      },
    ],
  });
  assert.deepEqual(result, {
    devices: [
      {
        id: "phone",
        serial: "phone",
        name: "Physical phone",
        kind: "Physical device",
        booted: false,
        platform: "android",
      },
      {
        id: "running-sim",
        serial: "running-sim",
        name: "Running simulator",
        kind: "simulator",
        booted: true,
        platform: "ios",
      },
    ],
    hiddenUnavailableCount: 1,
  });
});

test("non-device and malformed results remain unchanged", () => {
  const value = { devices: [{ id: "bad" }] };
  assert.equal(summarizeTargetOperationResult("target.devices.list", value), value);
  assert.equal(summarizeTargetOperationResult("target.list", value), value);
});
