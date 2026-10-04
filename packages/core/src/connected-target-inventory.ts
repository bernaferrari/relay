import type { DeviceSummary, TargetDefinition } from "@relay/protocol";
import { listAndroidDevicesFast, listDevices } from "./workspace-devices.js";
import { listTargets } from "./targets.js";

type InventoryDependencies = {
  listDevices(): Promise<DeviceSummary[]>;
  listAndroidDevicesFast(): Promise<DeviceSummary[]>;
  listTargets(): Promise<TargetDefinition[]>;
};

const dependencies: InventoryDependencies = {
  listDevices,
  listAndroidDevicesFast,
  listTargets,
};

export async function listConnectedTargets(
  scope: { phase?: "android" | "ios"; targetId?: string; targetKind?: "device" | "browser" } = {},
  runtime: InventoryDependencies = dependencies,
): Promise<{ devices: DeviceSummary[]; physicalDeviceCount?: number }> {
  const targetId = scope.targetId?.trim();
  const selected = (devices: DeviceSummary[]) =>
    targetId ? devices.filter((device) => (device.serial || device.id) === targetId) : devices;
  const browsers = async () =>
    (await runtime.listTargets())
      .filter((target) => target.kind === "browser")
      .map((target) => ({
        id: target.id,
        serial: target.id,
        name: target.name,
        kind: "Managed browser",
        booted: true,
        platform: "browser" as const,
        targetKind: "browser" as const,
      }));
  // A managed browser is listed from the canonical registry, never from ADB
  // or Apple discovery. Typed callers can avoid waiting on unrelated hardware;
  // untyped callers retain both kinds even when their identifiers collide.
  if (scope.targetKind === "browser") {
    return { devices: scope.phase ? [] : selected(await browsers()) };
  }
  if (scope.phase === "android") {
    return { devices: selected(await runtime.listAndroidDevicesFast().catch(() => [])) };
  }
  if (scope.phase === "ios") {
    return {
      devices: selected(
        (await runtime.listDevices().catch(() => [])).filter((device) => device.platform === "ios"),
      ),
    };
  }
  const mobile = await runtime.listDevices().catch(() => []);
  return {
    devices: selected(scope.targetKind === "device" ? mobile : [...mobile, ...(await browsers())]),
    physicalDeviceCount: mobile.length,
  };
}
