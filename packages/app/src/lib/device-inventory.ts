import type { DeviceInfo } from "./api-types";

function bySerial(devices: readonly DeviceInfo[]): Map<string, DeviceInfo> {
  return new Map(devices.map((device) => [device.serial, device]));
}

/**
 * Reconcile the fast ADB phase with the slower cross-platform scan without a
 * visible empty phase. Fast reachability wins when present; the full scan can
 * still supply Android metadata when one ADB sample is transiently empty.
 */
export function reconcileDeviceScan(
  previous: readonly DeviceInfo[],
  fastAndroid: readonly DeviceInfo[],
  full: readonly DeviceInfo[],
): DeviceInfo[] {
  const previousBySerial = bySerial(previous);
  const fastBySerial = bySerial(fastAndroid);
  const fullAndroid = full.filter((device) => device.platform === "android");
  const authoritativeAndroid = fastAndroid.length ? fastAndroid : fullAndroid;
  const fullAndroidBySerial = bySerial(fullAndroid);
  const android = authoritativeAndroid.map((device) => {
    const details = fullAndroidBySerial.get(device.serial);
    const prior = previousBySerial.get(device.serial);
    return {
      ...prior,
      ...details,
      ...device,
      serial: device.serial,
      // A current fast observation owns reachability. When the fallback is the
      // full scan, its own state remains intact.
      ...(fastBySerial.has(device.serial)
        ? { booted: device.booted, connectionState: device.connectionState }
        : {}),
    };
  });
  return [...android, ...full.filter((device) => device.platform !== "android")];
}

/** Keep connected Android rows visible while the slower phase is pending. */
export function interimDeviceScan(
  previous: readonly DeviceInfo[],
  fastAndroid: readonly DeviceInfo[],
): DeviceInfo[] {
  const priorAndroid = previous.filter((device) => device.platform === "android");
  const android = fastAndroid.length ? fastAndroid : priorAndroid;
  return [...android, ...previous.filter((device) => device.platform !== "android")];
}
