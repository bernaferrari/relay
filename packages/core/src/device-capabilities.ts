import type { createAgentDeviceClient } from "agent-device";
import type { CrashEvidenceResult } from "./crash-evidence.js";

type NativeDevice = ReturnType<typeof createAgentDeviceClient>;

/**
 * Read-only target capability available to recipes and workflow orchestration.
 *
 * This deliberately omits every physical mutation primitive. Workflows express
 * a user-visible intent through the canonical helpers, whose single dispatcher
 * owns iOS exact-once terminality. Supported adapters return a frozen runtime
 * observation facade too: their complete transport stays in a private registry
 * and is available only to the canonical dispatcher.
 *
 * This is a trusted-process capability boundary, not a security sandbox: code
 * in the repository can still deliberately import private source files or
 * modify an adapter before Relay wraps it. Package exports and the source gate
 * make that choice explicit and reviewable; they do not claim to make it
 * impossible in a hostile JavaScript realm.
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
  /** Rendered browser text, separate from an accessible name in `label`. */
  content?: string;
  /** Android content-desc. Distinct from visible text so TalkBack review can
   * tell what the screen reader will speak. */
  description?: string;
  identifier?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  /** Native editable text control, including composers with nested buttons. */
  editable?: boolean;
  visibleToUser?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  ref?: string;
  index?: number;
  depth?: number;
  parentIndex?: number;
  /** Owning Android package when the provider exposes multi-window nodes. */
  bundleId?: string;
  /** Scroll container forward-content hint. `true` means more content;
   * `false` is an explicit provider exhaustion receipt; omitted is unknown. */
  hiddenContentBelow?: boolean;
  /** Listener querySelector nodes already use the logical interface space. */
  logicalCoordinates?: boolean;
};
