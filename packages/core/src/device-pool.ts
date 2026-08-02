import type { DeviceLease, DevicePool } from "@relay/protocol";
import type { ListedDevice } from "./workspace.js";

export type DevicePoolTargetStatus = {
  serial: string;
  connected: boolean;
  platform?: "android" | "ios";
  name?: string;
  lease: "available" | "leased";
  leaseOwnerId?: string;
  leaseExpiresAt?: number;
};

export type DevicePoolPreflight = {
  poolId: string;
  ok: boolean;
  checkedAt: number;
  capacity: {
    configured: number;
    connected: number;
    available: number;
    leased: number;
  };
  targets: DevicePoolTargetStatus[];
  checks: Array<{
    id: string;
    status: "pass" | "warning" | "fail";
    message: string;
  }>;
};

export function validateDevicePool(input: Pick<DevicePool, "platform" | "deviceSerials">): void {
  const serials = input.deviceSerials.map((serial) => serial.trim());
  if (serials.some((serial) => !serial)) throw new Error("Device pool serials cannot be empty");
  if (new Set(serials).size !== serials.length) {
    throw new Error("Device pool serials must be unique");
  }
}

export function preflightDevicePool(input: {
  pool: DevicePool;
  devices: ListedDevice[];
  leases: DeviceLease[];
  at?: number;
}): DevicePoolPreflight {
  validateDevicePool(input.pool);
  const at = input.at ?? Date.now();
  const devices = new Map(input.devices.map((device) => [device.serial, device]));
  const activeLeases = new Map(
    input.leases
      .filter(
        (lease) =>
          lease.poolId === input.pool.id && lease.status === "leased" && lease.expiresAt > at,
      )
      .map((lease) => [lease.deviceSerial, lease]),
  );
  const targets = input.pool.deviceSerials.map((serial): DevicePoolTargetStatus => {
    const device = devices.get(serial);
    const lease = activeLeases.get(serial);
    return {
      serial,
      connected: Boolean(device),
      ...(device ? { platform: device.platform, name: device.name } : {}),
      lease: lease ? "leased" : "available",
      ...(lease ? { leaseOwnerId: lease.ownerId, leaseExpiresAt: lease.expiresAt } : {}),
    };
  });
  const connected = targets.filter((target) => target.connected).length;
  const leased = targets.filter((target) => target.connected && target.lease === "leased").length;
  const platformMismatch = targets.filter(
    (target) =>
      target.platform && input.pool.platform !== "mixed" && target.platform !== input.pool.platform,
  );
  const checks: DevicePoolPreflight["checks"] = [
    {
      id: "configured-targets",
      status: targets.length > 0 ? "pass" : "fail",
      message:
        targets.length > 0 ? `${targets.length} target(s) configured` : "Pool has no targets",
    },
    {
      id: "connected-targets",
      status:
        connected === targets.length && connected > 0 ? "pass" : connected > 0 ? "warning" : "fail",
      message: `${connected} of ${targets.length} target(s) connected`,
    },
    {
      id: "platform",
      status: platformMismatch.length === 0 ? "pass" : "fail",
      message:
        platformMismatch.length === 0
          ? `Connected targets match the ${input.pool.platform} pool`
          : `${platformMismatch.length} connected target(s) do not match the pool platform`,
    },
  ];
  return {
    poolId: input.pool.id,
    ok: !checks.some((check) => check.status === "fail"),
    checkedAt: at,
    capacity: {
      configured: targets.length,
      connected,
      available: Math.max(0, connected - leased),
      leased,
    },
    targets,
    checks,
  };
}
