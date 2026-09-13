/**
 * Device discovery and target resolution. Isolated from live sessions so the
 * picker can never inherit the last human/agent app binding.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compileBrowserEnvironment, type TargetRuntimeReadiness } from "@relay/protocol";
import { bootTarget, createDevice, type Device, type DevicePlatform } from "./device.js";
import { getExecutingJobId } from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { now, publish } from "./events.js";
import { getBrowserDevice } from "./browser-target.js";
import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";
import { resolveGoIosBinary } from "./ios-app-launch.js";
import { readTarget } from "./targets.js";
import {
  listAdbDevices,
  probeAdbDevices,
  type AndroidConnectionState,
  type AdbDeviceObservation,
} from "./adb-devices.js";
import {
  currentTargetContext,
  inferDevicePlatformFromSerial,
  runWithTargetContext,
  type TargetContext,
} from "./target-context.js";
import { targetRuntimeReadiness } from "./target-runtime-readiness.js";
import { androidAvdNameForSerial, observeAndroidAvdName } from "./android-avd.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";

export type ListedDevice = {
  id: string;
  name: string;
  serial: string;
  kind: string | null;
  booted: boolean | null;
  platform: DevicePlatform;
  /** Exact configured AVD name when this emulator was observed by Relay. */
  avdName?: string;
  /** Direct platform-tool state, used to explain why attached hardware is not selectable. */
  connectionState?: AndroidConnectionState;
  /** Observed by the adapter or the platform tool; omitted when unavailable. */
  osVersion?: string;
  /** Physical iOS devices need Developer Mode before Xcode can install Relay's local runner. */
  developerMode?: "enabled" | "disabled";
  /** Xcode has mounted the platform services needed to install and run Relay's local iOS runner. */
  developerServicesAvailable?: boolean;
  /**
   * Recent, per-target runtime facts. This is intentionally separate from
   * platform capabilities: discovery never pretends a booted iPad has an
   * attached XCTest accessibility session.
   */
  readiness?: TargetRuntimeReadiness;
};

const execFileAsync = promisify(execFile);
const observedDevicePlatforms = new Map<string, { platform: DevicePlatform; expiresAt: number }>();
const DEVICE_PLATFORM_CACHE_TTL_MS = 30_000;
// Apple device discovery enumerates simulators and attached hardware together.
// On a workspace with many installed simulators this routinely takes a little
// longer than two seconds, so an aggressively short cutoff made real iPads
// disappear from Relay's picker even though the adapter had found them.
const DEVICE_DISCOVERY_TIMEOUT_MS = 5_000;
let lastAuthoritativeAppleHardware: AppleHardwareInventory | null = null;
let lastGoIosSerials: Set<string> | null = null;

type AppleDeviceControlRecord = {
  identifier?: unknown;
  deviceProperties?: {
    bootState?: unknown;
    name?: unknown;
    osVersionNumber?: unknown;
    developerModeStatus?: unknown;
    ddiServicesAvailable?: unknown;
  };
  hardwareProperties?: {
    platform?: unknown;
    reality?: unknown;
    udid?: unknown;
  };
  connectionProperties?: {
    /** CoreDevice keeps paired hardware in its inventory after unplugging it. */
    tunnelState?: unknown;
  };
};

type AppleHardwareInventory = {
  devices: ListedDevice[];
  knownDevices: ListedDevice[];
  /** False means devicectl itself failed, so its empty result must not hide a usable adapter row. */
  authoritative: boolean;
};

export function parseConnectedAppleHardwareDevices(
  records: readonly AppleDeviceControlRecord[],
): ListedDevice[] {
  return records.flatMap((device) => {
    const hardware = device.hardwareProperties;
    const properties = device.deviceProperties;
    const udid = typeof hardware?.udid === "string" ? hardware.udid.trim() : "";
    const name = typeof properties?.name === "string" ? properties.name.trim() : "";
    const platform = typeof hardware?.platform === "string" ? hardware.platform : "";
    const reality = typeof hardware?.reality === "string" ? hardware.reality : "";
    const tunnelState =
      typeof device.connectionProperties?.tunnelState === "string"
        ? device.connectionProperties.tunnelState.toLowerCase()
        : "";
    if (
      !udid ||
      !name ||
      !/^ios$/i.test(platform) ||
      !/^physical$/i.test(reality) ||
      /^(?:unavailable|disconnected)$/i.test(tunnelState)
    ) {
      return [];
    }
    const bootState = typeof properties?.bootState === "string" ? properties.bootState : "";
    const osVersion =
      typeof properties?.osVersionNumber === "string"
        ? properties.osVersionNumber.trim()
        : undefined;
    const developerModeStatus =
      typeof properties?.developerModeStatus === "string"
        ? properties.developerModeStatus.toLowerCase()
        : "";
    const developerServicesAvailable =
      typeof properties?.ddiServicesAvailable === "boolean"
        ? properties.ddiServicesAvailable
        : undefined;
    return [
      {
        id: udid,
        serial: udid,
        name,
        kind: "Physical device",
        // Connected physical hardware does not consistently expose bootState.
        booted: !bootState || /^booted$/i.test(bootState),
        platform: "ios" as const,
        ...(osVersion ? { osVersion } : {}),
        ...(developerModeStatus === "enabled" || developerModeStatus === "disabled"
          ? { developerMode: developerModeStatus }
          : {}),
        ...(developerServicesAvailable !== undefined ? { developerServicesAvailable } : {}),
      },
    ];
  });
}

/**
 * Xcode's CoreDevice command is the platform source of truth for attached
 * iPhones and iPads. Keep it as a small discovery fallback: the SDK normally
 * supplies simulators and device metadata, while CoreDevice makes physical
 * hardware visible even when the SDK is being bundled by Electron.
 */
async function listAppleHardwareDevices(): Promise<AppleHardwareInventory> {
  const directory = await mkdtemp(join(tmpdir(), "relay-devicectl-"));
  const output = join(directory, "devices.json");
  try {
    await execFileAsync("xcrun", ["devicectl", "list", "devices", "--json-output", output], {
      timeout: 8_000,
      maxBuffer: 16 * 1024,
    });
    const parsed = JSON.parse(await readFile(output, "utf8")) as {
      result?: { devices?: AppleDeviceControlRecord[] };
    };
    const records = parsed.result?.devices ?? [];
    const inventory = {
      devices: parseConnectedAppleHardwareDevices(records),
      // CoreDevice retains trustworthy model/version metadata after its local
      // tunnel closes. go-ios may still reach the same paired device over its
      // own tunnel, so retain metadata separately from reachability.
      knownDevices: parseConnectedAppleHardwareDevices(
        records.map(({ connectionProperties: _connection, ...device }) => device),
      ),
      authoritative: true,
    } satisfies AppleHardwareInventory;
    lastAuthoritativeAppleHardware = inventory;
    return inventory;
  } catch {
    // A transient CoreDevice failure must not revive the adapter's remembered
    // row for an unplugged iPad. Reuse the last authoritative Mac inventory;
    // before the first successful sample, prefer no physical Apple rows to a
    // convincing but stale “Preparing” target. Non-Mac hosts may still rely on
    // a remote adapter, so only CoreDevice-capable hosts enforce this rule.
    return {
      devices: lastAuthoritativeAppleHardware?.devices ?? [],
      knownDevices: lastAuthoritativeAppleHardware?.knownDevices ?? [],
      authoritative: lastAuthoritativeAppleHardware !== null || process.platform === "darwin",
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function listGoIosDeviceSerials(): Promise<Set<string> | null> {
  try {
    const bin = await resolveGoIosBinary();
    const result = await execFileAsync(bin, ["list"], {
      timeout: 4_000,
      maxBuffer: 16 * 1024,
    });
    const parsed = JSON.parse(result.stdout) as { deviceList?: unknown };
    const serials = new Set(
      Array.isArray(parsed.deviceList)
        ? parsed.deviceList.filter(
            (serial): serial is string => typeof serial === "string" && serial.length > 0,
          )
        : [],
    );
    lastGoIosSerials = serials;
    return serials;
  } catch {
    // One failed probe must not make a reachable Wi-Fi iPad blink out.
    return lastGoIosSerials;
  }
}

function explicitOsVersion(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const candidates = [
    record.osVersion,
    record.runtimeVersion,
    record.platformVersion,
    record.os && typeof record.os === "object"
      ? (record.os as Record<string, unknown>).version
      : undefined,
  ];
  return candidates
    .find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    )
    ?.trim();
}

async function observedAndroidVersion(serial: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync(
      await resolveAndroidSdkTool("adb"),
      ["-s", serial, "shell", "getprop", "ro.build.version.release"],
      {
        timeout: 1500,
        maxBuffer: 4096,
      },
    );
    const version = result.stdout.trim();
    return version || undefined;
  } catch {
    // ADB may not be installed or the target may be remote. Unknown is more
    // truthful than a guessed version, and the matrix UI explains the gap.
    return undefined;
  }
}

/**
 * Return attached Android hardware directly from ADB without waiting for the
 * cross-platform adapter or Apple's comparatively slow device inventory.
 * This is the picker’s first discovery phase; a full scan enriches and
 * replaces these rows moments later.
 */
export async function listAndroidDevicesFast(): Promise<ListedDevice[]> {
  const observed = await listAdbDevices();
  const devices = observed.map((device) => mergeAdbObservation(undefined, device));
  const expiresAt = Date.now() + DEVICE_PLATFORM_CACHE_TTL_MS;
  for (const device of devices) {
    observedDevicePlatforms.set(device.serial, { platform: "android", expiresAt });
  }
  return devices.map(withRuntimeReadiness);
}

function withRuntimeReadiness(device: ListedDevice): ListedDevice {
  return { ...device, readiness: targetRuntimeReadiness(device) };
}

export async function listDevices(): Promise<ListedDevice[]> {
  // Discovery is intentionally isolated from every controllable target. It
  // may enumerate all adapters, but it can never inherit an app session or
  // input authority from whichever device a human or agent used last.
  const client = createDevice({ kind: "device", platform: "android", serial: "discovery" });
  // USB/ADB is the source of truth for attached Android hardware. The optional
  // SDK adapter can occasionally wait on an app session, so never let its
  // discovery call freeze the device picker or hide a phone ADB can see.
  const adapterList = Promise.race([
    client.devices.list().then(
      (devices) => ({ devices, error: null }),
      (error: unknown) => ({ devices: [], error }),
    ),
    new Promise<{ devices: []; error: Error }>((resolve) => {
      setTimeout(() => {
        resolve({
          devices: [],
          error: new Error("Relay device adapter did not respond in time"),
        });
      }, DEVICE_DISCOVERY_TIMEOUT_MS);
    }),
  ]);
  const [adapterResult, adbInventory, appleHardware, goIosSerials] = await Promise.all([
    adapterList,
    probeAdbDevices(),
    listAppleHardwareDevices(),
    listGoIosDeviceSerials(),
  ]);
  const adbDevices = adbInventory.devices;
  await Promise.all(
    adbDevices
      .filter((device) => device.kind === "Emulator" && device.connectionState === "connected")
      .map((device) => observeAndroidAvdName(device.serial).catch(() => undefined)),
  );
  if (adapterResult.error && adbDevices.length === 0 && appleHardware.devices.length === 0) {
    throw adapterResult.error;
  }

  const devices = adapterResult.devices;
  let listed: ListedDevice[] = await Promise.all(
    devices
      .filter((device) => device.platform === "android" || device.platform === "ios")
      .map(async (d) => {
        const platform = d.platform as DevicePlatform;
        const serial =
          d.android?.serial ?? d.ios?.udid ?? d.identifiers?.serial ?? d.identifiers?.udid ?? d.id;
        const osVersion =
          explicitOsVersion(d) ??
          (platform === "android" ? await observedAndroidVersion(serial) : undefined);
        return {
          id: d.id,
          name: d.name,
          serial,
          kind: d.kind ?? null,
          booted: d.booted ?? null,
          platform,
          ...(platform === "android" && d.kind && /emulator/i.test(d.kind)
            ? (() => {
                const avdName = androidAvdNameForSerial(serial);
                return avdName ? { avdName } : {};
              })()
            : {}),
          ...(platform === "android" ? { connectionState: "connected" as const } : {}),
          ...(osVersion ? { osVersion } : {}),
        };
      }),
  );

  listed = reconcileAdapterAndroidReachability(listed, adbDevices, adbInventory.authoritative);

  const connectedAppleDevices = new Map(
    appleHardware.devices.map((device) => [device.serial, device]),
  );
  if (goIosSerials) {
    const knownBySerial = new Map(
      appleHardware.knownDevices.map((device) => [device.serial, device]),
    );
    for (const serial of goIosSerials) {
      if (connectedAppleDevices.has(serial)) continue;
      const known = knownBySerial.get(serial);
      if (known) {
        const { developerServicesAvailable: _services, ...reachable } = known;
        connectedAppleDevices.set(serial, { ...reachable, booted: true });
      } else {
        connectedAppleDevices.set(serial, {
          id: serial,
          serial,
          name: "iOS device",
          kind: "Physical device",
          booted: true,
          platform: "ios",
        });
      }
    }
  }

  if (appleHardware.authoritative || goIosSerials) {
    const connectedAppleSerials = new Set(connectedAppleDevices.keys());
    listed = listed.filter(
      (device) =>
        device.platform !== "ios" ||
        /simulator|emulator/i.test(String(device.kind ?? "")) ||
        connectedAppleSerials.has(device.serial),
    );
  }

  const bySerial = new Map(listed.map((device) => [device.serial, device]));
  const adbVersions = new Map(
    await Promise.all(
      adbDevices
        .filter((device) => device.connectionState === "connected")
        .map(
          async (device) => [device.serial, await observedAndroidVersion(device.serial)] as const,
        ),
    ),
  );
  for (const observed of adbDevices) {
    const existing = bySerial.get(observed.serial);
    const merged = mergeAdbObservation(existing, observed);
    const osVersion = merged.osVersion ?? adbVersions.get(observed.serial);
    bySerial.set(observed.serial, osVersion ? { ...merged, osVersion } : merged);
  }
  for (const observed of connectedAppleDevices.values()) {
    const existing = bySerial.get(observed.serial);
    bySerial.set(observed.serial, mergeAppleObservation(existing, observed));
  }

  const merged = [...bySerial.values()].sort((left, right) => {
    const rank = (device: ListedDevice) =>
      device.kind === "Physical device" ? 0 : device.booted !== false ? 1 : 2;
    return rank(left) - rank(right);
  });
  const expiresAt = Date.now() + DEVICE_PLATFORM_CACHE_TTL_MS;
  for (const device of merged) {
    observedDevicePlatforms.set(device.serial, { platform: device.platform, expiresAt });
  }
  const withReadiness = merged.map(withRuntimeReadiness);
  publish({ type: "device.list", at: now(), count: withReadiness.length });
  return withReadiness;
}

/** A successful ADB sample owns Android reachability. Adapter metadata may be
 * slower or cached, but it must never keep an unplugged phone selectable. */
export function reconcileAdapterAndroidReachability(
  adapterDevices: readonly ListedDevice[],
  adbDevices: readonly AdbDeviceObservation[],
  authoritative: boolean,
): ListedDevice[] {
  if (!authoritative) return [...adapterDevices];
  const attached = new Set(adbDevices.map((device) => device.serial));
  return adapterDevices.filter(
    (device) => device.platform !== "android" || attached.has(device.serial),
  );
}

function mergeAppleObservation(
  existing: ListedDevice | undefined,
  observed: ListedDevice,
): ListedDevice {
  if (!existing) return observed;
  return {
    ...existing,
    id: observed.id,
    serial: observed.serial,
    name: observed.name || existing.name,
    kind: observed.kind,
    booted: observed.booted,
    platform: "ios",
    ...(observed.osVersion ? { osVersion: observed.osVersion } : {}),
    ...(observed.developerMode ? { developerMode: observed.developerMode } : {}),
    ...(observed.developerServicesAvailable !== undefined
      ? { developerServicesAvailable: observed.developerServicesAvailable }
      : {}),
  };
}

function mergeAdbObservation(
  existing: ListedDevice | undefined,
  observed: AdbDeviceObservation,
): ListedDevice {
  const connected = observed.connectionState === "connected";
  if (!existing) {
    return {
      id: observed.serial,
      serial: observed.serial,
      name: observed.name,
      kind: observed.kind,
      booted: connected,
      platform: "android",
      connectionState: observed.connectionState,
      ...(androidAvdNameForSerial(observed.serial)
        ? { avdName: androidAvdNameForSerial(observed.serial) }
        : {}),
    };
  }

  return {
    ...existing,
    name: existing.name || observed.name,
    kind: existing.kind ?? observed.kind,
    booted: connected ? true : false,
    connectionState: observed.connectionState,
    ...(androidAvdNameForSerial(observed.serial)
      ? { avdName: androidAvdNameForSerial(observed.serial) }
      : {}),
  };
}

/**
 * Boot a not-running simulator/emulator so tests and recording can start
 * without leaving the app. Physical devices reject this server-side.
 */
export async function bootDevice(serial: string, platform: DevicePlatform): Promise<void> {
  await runTargetMutation(serial, getExecutingJobId(), async () => {
    const client = createDevice({ kind: "device", platform, serial });
    await bootTarget(
      client,
      platform === "ios" ? { platform, udid: serial } : { platform, serial },
    );
  });
  publish({ type: "device.booted", at: now(), serial });
}

/** Retry the host-to-device ADB handshake. Android still requires the user to
 * approve the RSA key on the phone; this only makes that system prompt appear. */
export async function requestAndroidAuthorization(serial: string): Promise<void> {
  const target = serial.trim();
  if (!target) throw new Error("serial is required");
  const attached = (await listAdbDevices()).find((device) => device.serial === target);
  if (!attached) throw new Error("Android device is no longer attached");
  if (attached.connectionState === "connected") return;

  await runTargetMutation(target, getExecutingJobId(), async () => {
    await execFileAsync(await resolveAndroidSdkTool("adb"), ["-s", target, "reconnect"], {
      timeout: 8_000,
      maxBuffer: 16 * 1024,
    });
  });
  publish({ type: "device.authorization-requested", at: now(), serial: target });
}

/**
 * Resolve a physical platform without repeatedly invoking the comparatively
 * expensive Apple device discovery command. The cache is refreshed by every
 * full device-list request and expires quickly enough to follow reconnects.
 */
export async function devicePlatformForSerial(serial: string): Promise<DevicePlatform | undefined> {
  const observed = observedDevicePlatforms.get(serial);
  if (observed && observed.expiresAt > Date.now()) return observed.platform;
  if (observed) observedDevicePlatforms.delete(serial);
  return (await listDevices()).find((device) => device.serial === serial)?.platform;
}

/** Jobs default to Android when platform is omitted. Resolve from the serial instead. */
export async function resolveJobDevicePlatform(
  serial: string | undefined,
  explicit?: DevicePlatform,
): Promise<DevicePlatform | undefined> {
  if (explicit) return explicit;
  const id = serial?.trim();
  if (!id) return undefined;
  return (await devicePlatformForSerial(id)) ?? inferDevicePlatformFromSerial(id);
}

export type RuntimeTargetOverlay = {
  authenticationFixtureId?: string;
  projectId?: string;
};

async function browserDeviceForOverlay(
  targetId: string,
  overlay?: RuntimeTargetOverlay,
): Promise<Device> {
  const fixtureId = overlay?.authenticationFixtureId?.trim();
  if (!fixtureId) return getBrowserDevice(targetId);
  const target = await readTarget(targetId);
  if (!target?.browser) return getBrowserDevice(targetId);
  return getBrowserDevice(targetId, {
    mode: "proof",
    profile: compileBrowserEnvironment({
      ...browserCaseProfileForTarget(target),
      authenticationFixtureId: fixtureId,
    }),
    ...(overlay?.projectId ? { projectId: overlay.projectId } : {}),
  });
}

export async function resolveRuntimeTarget(
  serial?: string,
  provided?: Device,
  overlay?: RuntimeTargetOverlay,
): Promise<{ context: TargetContext; device: Device }> {
  if (provided) return { context: currentTargetContext(), device: provided };
  if (serial) {
    if (await readTarget(serial)) {
      const context = { kind: "browser", platform: "browser", targetId: serial } as const;
      return {
        context,
        device: await runWithTargetContext(context, () => browserDeviceForOverlay(serial, overlay)),
      };
    }
    // HTTP callers identify a device by serial, but they do not share the
    // desktop process's selected-target environment. Never infer a platform
    // from that process-global fallback here: an iPad serial would otherwise
    // be routed through Android's adb screenshot/input paths.
    const platform = (await devicePlatformForSerial(serial)) ?? undefined;
    if (!platform) throw new Error(`Target ${serial} is not connected or configured`);
    const context = { kind: "device", platform, serial } as const;
    return {
      context,
      device: await runWithTargetContext(context, async () => createDevice()),
    };
  }
  const context = currentTargetContext();
  return {
    context,
    device: context.kind === "browser" ? await getBrowserDevice(context.targetId) : createDevice(),
  };
}
