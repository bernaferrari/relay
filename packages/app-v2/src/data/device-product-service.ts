import type { ActionSummary, DeviceSummary, OperationOutput } from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

export type ProductDeviceStatus = "ready" | "needs-attention" | "virtual";

export type ProductDevice = {
  id: string;
  name: string;
  serial: string;
  platform: DeviceSummary["platform"];
  kind: string | null;
  osVersion?: string;
  status: ProductDeviceStatus;
  runnable: boolean;
  recovery?: string;
  device: DeviceSummary;
};

export type ProductDeviceRecovery = {
  serial: string;
  recovered: boolean;
  ready: boolean;
  summary: string;
  actions: readonly { kind: string; status: string; detail: string }[];
  session: { status: string; detail: string; app?: string; fallback?: boolean };
};

export type ProductLaunchedApp = OperationOutput<"target.app.launch">["launched"];

export type DeviceProductService = {
  list(): Promise<readonly ProductDevice[]>;
  get(deviceId: string): Promise<ProductDevice | undefined>;
  actions(): Promise<readonly ActionSummary[]>;
  recover(
    serial: string,
    reason?: "connect" | "observe" | "control" | "record" | "auto",
  ): Promise<ProductDeviceRecovery>;
  /** Launch is supported only for attached Android/iOS devices by the
   * canonical target operation; managed browsers remain a separate target. */
  launchApp?(deviceId: string, app: string, relaunch?: boolean): Promise<ProductLaunchedApp>;
};

export const deviceQueryKeys = {
  devices: ["devices"] as const,
  device: (deviceId: string) => ["devices", deviceId] as const,
  actions: ["devices", "actions"] as const,
};

function identity(device: DeviceSummary): string {
  return device.serial || device.id;
}

function isVirtual(device: DeviceSummary): boolean {
  return device.platform === "browser" || /emulator|simulator|virtual/i.test(device.kind ?? "");
}

function readiness(device: DeviceSummary): { runnable: boolean; recovery?: string } {
  if (device.platform !== "android" && device.platform !== "ios") {
    return {
      runnable: false,
      recovery: "Relay checks this managed browser again when you start a Test.",
    };
  }
  const connection = device.connectionState?.toLowerCase();
  const recoveries: Record<string, string> = {
    disconnected: "Reconnect the device, then check its status again.",
    offline: "Wake or reconnect the device, then check its status again.",
    unauthorized: "Approve the connection on the Android device, then check its status again.",
  };
  if (connection && connection !== "connected") {
    return {
      runnable: false,
      recovery:
        recoveries[connection] ??
        "Relay cannot verify this device’s connection. Keep it awake and connected, then check again.",
    };
  }
  if (device.booted === false) {
    return {
      runnable: false,
      recovery: "Start the emulator or simulator, then check its status again.",
    };
  }
  if (device.developerMode === "disabled") {
    return {
      runnable: false,
      recovery: "Enable Developer Mode on the Apple device, then check its status again.",
    };
  }
  if (device.developerServicesAvailable === false) {
    return {
      runnable: false,
      recovery: "Reconnect the Apple device, open Xcode once, then check its status again.",
    };
  }
  const channels = device.readiness
    ? [
        device.readiness.previewPixels,
        device.readiness.semanticControl,
        device.readiness.evidenceCapture,
      ]
    : [];
  if (channels.some((channel) => channel.freshness === "stale")) {
    return {
      runnable: false,
      recovery: "Keep the device on the expected screen, then check its status again.",
    };
  }
  if (device.platform === "ios" && channels.some((channel) => channel.state === "unavailable")) {
    return { runnable: false, recovery: "Reconnect the Apple device and check its screen again." };
  }
  return { runnable: true };
}

function project(device: DeviceSummary): ProductDevice {
  const targetReadiness = readiness(device);
  const virtual = isVirtual(device);
  return {
    id: device.id,
    name: device.name,
    serial: identity(device),
    platform: device.platform,
    kind: device.kind,
    ...(device.osVersion ? { osVersion: device.osVersion } : {}),
    status: virtual ? "virtual" : targetReadiness.runnable ? "ready" : "needs-attention",
    runnable: targetReadiness.runnable,
    ...(targetReadiness.runnable ? {} : { recovery: targetReadiness.recovery }),
    device,
  };
}

export function projectDevices(devices: readonly DeviceSummary[]): readonly ProductDevice[] {
  return devices
    .map(project)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function createDeviceProductService(platform: Platform): DeviceProductService {
  let clientPromise: ReturnType<typeof productClientForPlatform> | undefined;
  const client = () =>
    (clientPromise ??= productClientForPlatform(platform)).then(({ client }) => client);
  async function listDevices(): Promise<readonly ProductDevice[]> {
    const result = await (await client()).invoke("target.devices.list", {});
    return projectDevices(result.devices);
  }
  return {
    list: listDevices,
    async get(deviceId) {
      return (await listDevices()).find(
        (device) => device.id === deviceId || device.serial === deviceId,
      );
    },
    async actions() {
      return (await client()).invoke("target.actions.list", {}).then((result) => result.actions);
    },
    async recover(serial, reason = "auto") {
      const result = await (await client()).invoke("target.recover", { serial, reason });
      return result.recovery;
    },
    async launchApp(deviceId, app, relaunch) {
      const device = (await listDevices()).find(
        (candidate) => candidate.id === deviceId || candidate.serial === deviceId,
      );
      if (!device) throw new TypeError(`Device ${deviceId} is not available.`);
      if (device.platform !== "android" && device.platform !== "ios") {
        throw new TypeError("App launch is supported only for attached Android and iOS devices.");
      }
      const name = app.trim();
      if (!name) throw new TypeError("Enter an app name, package, or bundle identifier.");
      const result = await (
        await client()
      ).invoke("target.app.launch", {
        serial: device.serial,
        app: name,
        ...(relaunch === undefined ? {} : { relaunch }),
      });
      return result.launched;
    },
  };
}
