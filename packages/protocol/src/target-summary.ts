import type { DeviceSummary } from "./operations.js";

export type DeviceCatalogSummary = Pick<
  DeviceSummary,
  "id" | "serial" | "name" | "kind" | "booted" | "platform" | "connectionState" | "osVersion"
>;

/** Keep an agent's default device catalog focused on hardware it can act on.
 * The UI still receives the full discovery response and can offer stopped
 * simulators explicitly; CLI/MCP callers should not spend context on dozens of
 * unavailable runtimes while looking for a connected phone. */
export function summarizeTargetOperationResult(operationId: string, result: unknown): unknown {
  if (operationId !== "target.devices.list") return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const devices = (result as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return result;
  if (
    devices.some(
      (device) =>
        !device ||
        typeof device !== "object" ||
        Array.isArray(device) ||
        typeof (device as DeviceSummary).id !== "string" ||
        typeof (device as DeviceSummary).platform !== "string",
    )
  )
    return result;

  const available = (devices as DeviceSummary[]).filter(
    (device) => device.kind?.toLocaleLowerCase() !== "simulator" || device.booted === true,
  );
  return {
    ...(result as Record<string, unknown>),
    devices: available.map((device) => ({
      id: device.id,
      serial: device.serial,
      name: device.name,
      kind: device.kind,
      booted: device.booted,
      platform: device.platform,
      ...(device.connectionState ? { connectionState: device.connectionState } : {}),
      ...(device.osVersion ? { osVersion: device.osVersion } : {}),
    })),
    hiddenUnavailableCount: devices.length - available.length,
  };
}
