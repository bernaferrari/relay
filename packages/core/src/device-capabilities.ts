import { createAgentDeviceClient } from "agent-device";
import type { CrashEvidenceResult } from "./crash-evidence.js";
import type { NativeDeviceMutations } from "./device-mutation-adapter.js";

type NativeDevice = ReturnType<typeof createAgentDeviceClient>;

/**
 * Read-only target capability available to recipes and workflow orchestration.
 *
 * This deliberately omits every physical mutation primitive. Workflows express
 * a user-visible intent through the canonical helpers, whose single dispatcher
 * owns iOS exact-once terminality. The concrete SDK client still carries its
 * native methods at runtime, but they are intentionally absent from this public
 * type so a new workflow cannot compile a raw input escape hatch.
 */
export type Device = {
  devices: {
    list: (options?: Parameters<NativeDevice["devices"]["list"]>[0]) => Promise<
      Array<{
        id: string;
        name: string;
        platform: string;
        target?: string;
        kind?: string;
        booted?: boolean;
        identifiers?: { serial?: string; udid?: string };
        android?: { serial: string };
        ios?: { udid: string };
      }>
    >;
  };
  capture: {
    snapshot: (
      options?: Parameters<NativeDevice["capture"]["snapshot"]>[0],
    ) => Promise<{ nodes?: SnapshotNode[] }>;
    screenshot: (
      options?: Parameters<NativeDevice["capture"]["screenshot"]>[0],
    ) => Promise<{ path?: string; base64?: string }>;
  };
  /** Bounded semantic observation only; physical find-click stays dispatcher-owned. */
  interactions: {
    find: (
      options: Parameters<NativeDevice["interactions"]["find"]>[0] & { action: "exists" },
    ) => Promise<unknown>;
  };
  command: {
    wait: (options: Parameters<NativeDevice["command"]["wait"]>[0]) => Promise<unknown>;
    appState: (options?: Parameters<NativeDevice["command"]["appState"]>[0]) => Promise<
      | {
          platform: "ios" | "macos";
          appName: string;
          appBundleId?: string;
          source: "session";
          surface: string;
          device_udid?: string;
        }
      | { platform: "android"; package: string; activity: string }
    >;
  };
  observability: {
    perf: (options?: Parameters<NativeDevice["observability"]["perf"]>[0]) => Promise<unknown>;
    logs: (options?: Parameters<NativeDevice["observability"]["logs"]>[0]) => Promise<unknown>;
    network: (
      options?: Parameters<NativeDevice["observability"]["network"]>[0],
    ) => Promise<unknown>;
    audio: (options?: Parameters<NativeDevice["observability"]["audio"]>[0]) => Promise<unknown>;
    crashes: (options: { action: "start" | "dump"; since: number }) => Promise<CrashEvidenceResult>;
  };
};

export type SnapshotNode = {
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  visibleToUser?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  ref?: string;
  index?: number;
  depth?: number;
  parentIndex?: number;
  /** Owning Android package when the provider exposes multi-window nodes. */
  bundleId?: string;
};

/**
 * Approved dispatcher-only view of the bound SDK transport. It is deliberately
 * not re-exported from the package entrypoint; workflow modules receive only
 * `Device` and the architecture gate rejects direct imports of this seam.
 */
export type DeviceTransport = Device & NativeDeviceMutations;

export function nativeDevice(device: Device): DeviceTransport {
  return device as DeviceTransport;
}

/**
 * Explicit test-only injection seam. The returned value is still the safe
 * workflow facade, so tests exercise public dispatch rather than exposing raw
 * input methods to recipe code.
 */
export function deviceTestDouble<T extends object>(capabilities: T): Device {
  return capabilities as unknown as Device;
}
