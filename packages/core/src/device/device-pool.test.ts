import assert from "node:assert/strict";
import test from "node:test";
import { preflightDevicePool, validateDevicePool } from "./device-pool.js";

const pool = {
  id: "phones",
  projectId: "project",
  name: "Phones",
  platform: "mixed" as const,
  deviceSerials: ["android-1", "ios-1", "missing"],
  createdAt: 1,
  updatedAt: 1,
};

test("reports connected, leased, and usable pool capacity without guessing", () => {
  const result = preflightDevicePool({
    pool,
    at: 100,
    devices: [
      {
        id: "a",
        serial: "android-1",
        name: "Pixel",
        platform: "android",
        kind: null,
        booted: true,
      },
      { id: "i", serial: "ios-1", name: "iPhone", platform: "ios", kind: null, booted: true },
    ],
    leases: [
      {
        id: "lease",
        projectId: "project",
        poolId: "phones",
        deviceSerial: "android-1",
        ownerId: "agent",
        status: "leased",
        leasedAt: 1,
        expiresAt: 1_000,
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.capacity, { configured: 3, connected: 2, available: 1, leased: 1 });
  assert.equal(result.targets.find((target) => target.serial === "android-1")?.lease, "leased");
  assert.equal(result.targets.find((target) => target.serial === "missing")?.connected, false);
  assert.equal(result.checks.find((check) => check.id === "connected-targets")?.status, "warning");
});

test("rejects duplicate target serials", () => {
  assert.throws(
    () => validateDevicePool({ platform: "android", deviceSerials: ["one", "one"] }),
    /must be unique/,
  );
});
