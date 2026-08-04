/**
 * Live device workspace helpers for the testing shell:
 * snapshot UI tree, screenshot, basic interactions.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
import {
  type DevicePlatform,
  base,
  center,
  createDevice,
  findClick,
  pressIdentifier,
  pressLabel,
  pressMatchingText,
  pressPoint,
  pressRef,
  rememberedTargetApplication,
  snapshot,
  swipeGesture,
  typeText,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { getExecutingJobId, hardStopDeviceSession } from "./control.js";
import { now, publish } from "./events.js";
import { attachJobFrame, getActiveJob } from "./session.js";
import { getBrowserDevice } from "./browser-target.js";
import { readTarget } from "./targets.js";
import { observeScreenIdentity } from "./screen-identity.js";
import {
  listAdbDevices,
  type AndroidConnectionState,
  type AdbDeviceObservation,
} from "./adb-devices.js";
import {
  androidSnapshotApplication,
  androidSnapshotMatchesForeground,
  captureAndroidForegroundApp,
  captureAndroidInspectionState,
  captureAndroidUiSnapshotWithState,
  type AndroidInspectionState,
} from "./android-ui-snapshot.js";
import {
  currentTargetContext,
  runWithTargetContext,
  targetIdentity,
  type TargetContext,
} from "./target-context.js";
import { adbSwipeInputArgs } from "./adb-input.js";
import {
  IosRunnerSetupError,
  diagnoseIosRunnerError,
  prepareIosRunner,
  recordIosVideo,
} from "./ios-device-adapter.js";
import {
  isIosSessionBindingError,
  isRecoverableIosRuntimeError,
  recoverIosRuntime,
  recoverIosRuntimeSession,
  type IosRuntimeRecoveryResult,
  type IosRuntimeSessionRecovery,
} from "./ios-runtime-recovery.js";
import {
  inferIosSnapshotGeometry,
  normalizeIosSnapshotNodes,
  normalizeScreenshotToBounds,
  pngDimensions,
  type IosSnapshotGeometry,
} from "./ios-geometry.js";

export {
  inferIosSnapshotGeometry,
  normalizeIosSnapshotNodes,
  normalizeScreenshotToBounds,
} from "./ios-geometry.js";

/**
 * XCTest runner setup is a device concern, not a recording concern. A stage
 * opens by reading the screen, so that first read must be able to prepare the
 * iOS runner too. Keep one preparation in flight per device; otherwise the
 * initial screenshot and UI-tree polls race each other and each attempt can
 * try to sign/install the same runner.
 */
const iosRunnerPreparations = new Map<string, Promise<void>>();
const iosRunnerFailures = new Map<string, { error: Error; expiresAt: number }>();
const iosRuntimeRecoveries = new Map<string, Promise<IosRuntimeRecoveryResult>>();
const IOS_RUNNER_FAILURE_TTL_MS = 10_000;

async function restoreIosAppSession(
  device: Device,
  serial: string,
): Promise<{ app: string; fallback: boolean }> {
  const remembered = await rememberedTargetApplication({
    kind: "device",
    platform: "ios",
    serial,
  });
  const app = remembered ?? "com.apple.springboard";
  await device.apps.open({
    platform: "ios",
    udid: serial,
    app,
    relaunch: false,
    noRecord: true,
  });
  return { app, fallback: !remembered };
}

async function recoverIosHostRuntime(
  serial: string,
  cause: unknown,
  force = false,
): Promise<IosRuntimeRecoveryResult> {
  const existing = iosRuntimeRecoveries.get(serial);
  if (existing) return existing;
  const recovery = recoverIosRuntime({ serial, cause, force }).finally(() => {
    iosRuntimeRecoveries.delete(serial);
  });
  iosRuntimeRecoveries.set(serial, recovery);
  return recovery;
}

/** Forget runner preparation state after the Apple account or team changes. */
export function resetIosRunnerState(): void {
  iosRunnerPreparations.clear();
  iosRunnerFailures.clear();
  iosRuntimeRecoveries.clear();
}

export type TargetRuntimeRecovery = IosRuntimeSessionRecovery;

/** Shared UI/CLI/MCP recovery operation for attached Apple hardware. */
export async function recoverTargetRuntime(
  serial: string,
  cause?: unknown,
): Promise<TargetRuntimeRecovery> {
  const target = await resolveRuntimeTarget(serial);
  if (target.context.kind !== "device" || target.context.platform !== "ios") {
    throw new Error("Automatic runtime recovery is currently available for Apple devices only");
  }
  return runWithTargetContext(target.context, async () => {
    const inspect = async () => {
      await ensureIosRunnerPrepared(target.device, serial);
      return restoreIosAppSession(target.device, serial);
    };
    return recoverIosRuntimeSession(
      serial,
      inspect,
      async (sessionError) => {
        const host = await recoverIosHostRuntime(serial, cause ?? sessionError, true);
        iosRunnerPreparations.delete(serial);
        iosRunnerFailures.delete(serial);
        return host;
      },
      async (error) => (await diagnoseIosRunnerError(error, serial)).message,
    );
  });
}

function ensureIosRunnerPrepared(device: Device, serial: string): Promise<void> {
  const recentFailure = iosRunnerFailures.get(serial);
  if (recentFailure && recentFailure.expiresAt > Date.now()) {
    return Promise.reject(recentFailure.error);
  }
  if (recentFailure) iosRunnerFailures.delete(serial);

  const existing = iosRunnerPreparations.get(serial);
  if (existing) return existing;

  const preparation = prepareIosRunner(device, { udid: serial })
    .catch(async (error) => {
      if (!isRecoverableIosRuntimeError(error)) throw error;
      await recoverIosHostRuntime(serial, error);
      return prepareIosRunner(device, { udid: serial });
    })
    .then(() => {
      iosRunnerFailures.delete(serial);
    })
    .catch((error) => {
      iosRunnerPreparations.delete(serial);
      // A missing Xcode account or a provisioning error cannot be repaired by
      // another simultaneous screen poll. Briefly share the failure across
      // screenshot, snapshot, and video so the stage settles on one truthful
      // state instead of repeatedly launching xcodebuild.
      if (error instanceof IosRunnerSetupError) {
        iosRunnerFailures.set(serial, {
          error,
          expiresAt: Date.now() + IOS_RUNNER_FAILURE_TTL_MS,
        });
      }
      throw error;
    });
  iosRunnerPreparations.set(serial, preparation);
  return preparation;
}

/**
 * Recover from session binding conflicts by releasing the stale binding
 * and retrying. Does NOT auto-open any app — each recipe opens its own.
 */
async function withSession<T>(device: Device, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const context = currentTargetContext();
    if (
      isIosSessionBindingError(err) &&
      context.kind === "device" &&
      context.platform === "ios" &&
      context.serial
    ) {
      // Restore the application Relay intentionally opened. SpringBoard is a
      // truthful first-use fallback only when no application is known; it must
      // never replace Settings (or the app under test) after a daemon restart.
      await ensureIosRunnerPrepared(device, context.serial);
      await restoreIosAppSession(device, context.serial);
      return await op();
    }
    if (
      isRecoverableIosRuntimeError(err) &&
      context.kind === "device" &&
      context.platform === "ios" &&
      context.serial
    ) {
      await recoverIosHostRuntime(context.serial, err);
      iosRunnerPreparations.delete(context.serial);
      iosRunnerFailures.delete(context.serial);
      await ensureIosRunnerPrepared(device, context.serial);
      await restoreIosAppSession(device, context.serial);
      return await op();
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/already bound/i.test(msg) && !getExecutingJobId()) {
      if (context.kind === "device" && context.platform === "ios") {
        // A physical Apple target has one long-lived XCTest process. Releasing
        // the SDK session here also kills an active screen recorder and loses
        // its container-scoped MP4. Preserve the runner and surface the real
        // selector conflict; callers can correct their request without
        // destroying the device state they are trying to inspect.
        throw err;
      }
      await hardStopDeviceSession(context).catch(() => undefined);
      return await op();
    }
    throw err;
  }
}

/**
 * Raw adb screencap — captures the current device screen regardless of which
 * app is showing. Bypasses the SDK's session requirement entirely.
 * Used as a fallback when the SDK reports "No active session".
 */
function rawScreenshot(path: string, serial?: string): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const args = ["-s", serial, "exec-out", "screencap", "-p"];
  const buf = execFileSync("adb", args, { maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(path, buf);
}

/** Raw adb input tap — works without a session, on any app. */
function rawTap(x: number, y: number, serial?: string): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const args = ["-s", serial, "shell", "input", "tap", String(x), String(y)];
  execFileSync("adb", args, { timeout: 5000 });
}
/** Raw adb input swipe — works without a session, on any app. */
function rawSwipe(
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
  serial?: string,
): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const inputArgs = adbSwipeInputArgs(from, to, durationMs);
  const args = ["-s", serial, "shell", ...inputArgs];
  execFileSync("adb", args, { timeout: 8000 });
}

export type ListedDevice = {
  id: string;
  name: string;
  serial: string;
  kind: string | null;
  booted: boolean | null;
  platform: DevicePlatform;
  /** Direct platform-tool state, used to explain why attached hardware is not selectable. */
  connectionState?: AndroidConnectionState;
  /** Observed by the adapter or the platform tool; omitted when unavailable. */
  osVersion?: string;
  /** Physical iOS devices need Developer Mode before Xcode can install Relay's local runner. */
  developerMode?: "enabled" | "disabled";
  /** Xcode has mounted the platform services needed to install and run Relay's local iOS runner. */
  developerServicesAvailable?: boolean;
};

const execFileAsync = promisify(execFile);
const observedDevicePlatforms = new Map<string, { platform: DevicePlatform; expiresAt: number }>();
const DEVICE_PLATFORM_CACHE_TTL_MS = 30_000;
// Apple device discovery enumerates simulators and attached hardware together.
// On a workspace with many installed simulators this routinely takes a little
// longer than two seconds, so an aggressively short cutoff made real iPads
// disappear from Relay's picker even though the adapter had found them.
const DEVICE_DISCOVERY_TIMEOUT_MS = 5_000;

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
};

/**
 * Xcode's CoreDevice command is the platform source of truth for attached
 * iPhones and iPads. Keep it as a small discovery fallback: the SDK normally
 * supplies simulators and device metadata, while CoreDevice makes physical
 * hardware visible even when the SDK is being bundled by Electron.
 */
async function listAppleHardwareDevices(): Promise<ListedDevice[]> {
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
    return (parsed.result?.devices ?? []).flatMap((device) => {
      const hardware = device.hardwareProperties;
      const properties = device.deviceProperties;
      const udid = typeof hardware?.udid === "string" ? hardware.udid.trim() : "";
      const name = typeof properties?.name === "string" ? properties.name.trim() : "";
      const platform = typeof hardware?.platform === "string" ? hardware.platform : "";
      const reality = typeof hardware?.reality === "string" ? hardware.reality : "";
      if (!udid || !name || !/^ios$/i.test(platform) || !/^physical$/i.test(reality)) return [];
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
  } catch {
    return [];
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
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
      "adb",
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
  const [adapterResult, adbDevices, appleHardware] = await Promise.all([
    adapterList,
    listAdbDevices(),
    listAppleHardwareDevices(),
  ]);
  if (adapterResult.error && adbDevices.length === 0 && appleHardware.length === 0) {
    throw adapterResult.error;
  }

  const devices = adapterResult.devices;
  const listed: ListedDevice[] = await Promise.all(
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
          ...(platform === "android" ? { connectionState: "connected" as const } : {}),
          ...(osVersion ? { osVersion } : {}),
        };
      }),
  );

  const bySerial = new Map(listed.map((device) => [device.serial, device]));
  for (const observed of adbDevices) {
    const existing = bySerial.get(observed.serial);
    bySerial.set(observed.serial, mergeAdbObservation(existing, observed));
  }
  for (const observed of appleHardware) {
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
  publish({ type: "device.list", at: now(), count: merged.length });
  return merged;
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
    };
  }

  return {
    ...existing,
    name: existing.name || observed.name,
    kind: existing.kind ?? observed.kind,
    booted: connected ? true : false,
    connectionState: observed.connectionState,
  };
}

/**
 * Boot a not-running simulator/emulator so tests and recording can start
 * without leaving the app. Physical devices reject this server-side.
 */
export async function bootDevice(serial: string, platform: DevicePlatform): Promise<void> {
  const client = createDevice({ kind: "device", platform, serial });
  await client.devices.boot(platform === "ios" ? { platform, udid: serial } : { platform, serial });
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

  await execFileAsync("adb", ["-s", target, "reconnect"], {
    timeout: 8_000,
    maxBuffer: 16 * 1024,
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

async function resolveRuntimeTarget(
  serial?: string,
  provided?: Device,
): Promise<{ context: TargetContext; device: Device }> {
  if (provided) return { context: currentTargetContext(), device: provided };
  if (serial) {
    if (await readTarget(serial)) {
      const context = { kind: "browser", platform: "browser", targetId: serial } as const;
      return {
        context,
        device: await runWithTargetContext(context, () => getBrowserDevice(serial)),
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

export type SnapshotPayload = {
  serial?: string;
  capturedAt: number;
  nodes: SnapshotNode[];
  interactive: SnapshotNode[];
  /** rough screen bounds from max rect extents (for overlay scaling) */
  bounds?: { width: number; height: number };
  /** False when Android's hierarchy cannot be safely aligned with mirrored pixels. */
  inspectable: boolean;
  /** Capture implementation, useful for diagnostics without leaking host details to UI logic. */
  source: "sdk" | "android-system";
  inspectionState?: AndroidInspectionState;
  foregroundApp?: string;
  treeApp?: string;
  bindingState?: "matched" | "rebound" | "unavailable";
  /** Full normalized identity lets UI and agents explain and reuse a match;
   * a digest alone is not enough to repair an older visual-only baseline. */
  screenIdentity: import("@relay/protocol").ScreenIdentityObservation;
};

const iosSnapshotGeometryBySerial = new Map<string, IosSnapshotGeometry>();

export function inferSnapshotBounds(
  nodes: SnapshotNode[],
  platform?: DevicePlatform,
): { width: number; height: number } | undefined {
  if (platform === "ios") {
    // XCTest can expose portrait-oriented Window children while its root
    // Application already describes the logical landscape viewport. Taking
    // max child extents turns a 1112×834 iPad into a fictitious 1112×1112
    // square and shifts every normalized point interaction. The application
    // root is the authoritative coordinate space used by XCTest actions.
    const application = nodes.find(
      (node) =>
        node.depth === 0 &&
        node.type === "Application" &&
        node.rect &&
        node.rect.width >= 100 &&
        node.rect.height >= 100,
    );
    if (application?.rect) {
      return {
        width: Math.round(application.rect.width),
        height: Math.round(application.rect.height),
      };
    }
  }
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    if (!n.rect) continue;
    maxX = Math.max(maxX, n.rect.x + n.rect.width);
    maxY = Math.max(maxY, n.rect.y + n.rect.height);
  }
  if (maxX < 100 || maxY < 100) return undefined;
  return { width: Math.round(maxX), height: Math.round(maxY) };
}

async function snapshotThroughSdk(
  device: Device,
  interactiveOnly: boolean,
): Promise<SnapshotNode[]> {
  return await withSession(device, () => snapshot(device, { interactiveOnly }));
}

type SnapshotCapture = Pick<
  SnapshotPayload,
  | "nodes"
  | "inspectable"
  | "source"
  | "inspectionState"
  | "foregroundApp"
  | "treeApp"
  | "bindingState"
>;

async function snapshotForTarget(
  target: Awaited<ReturnType<typeof resolveRuntimeTarget>>,
  interactiveOnly: boolean,
): Promise<SnapshotCapture> {
  if (
    target.context.kind === "device" &&
    target.context.platform === "ios" &&
    target.context.serial
  ) {
    await ensureIosRunnerPrepared(target.device, target.context.serial);
  }
  if (
    target.context.kind !== "device" ||
    target.context.platform !== "android" ||
    !target.context.serial
  ) {
    return {
      // Apple can keep the local runner alive while dropping its app binding
      // after Relay restarts or the DDI reconnects. Screenshots already heal
      // that state through `withSession`; the accessibility tree must use the
      // same recovery path or authoring fails while the visible Live panel
      // continues to work.
      nodes:
        target.context.kind === "device" && target.context.platform === "ios"
          ? await withSession(target.device, () =>
              snapshotThroughSdk(target.device, interactiveOnly),
            )
          : await snapshotThroughSdk(target.device, interactiveOnly),
      inspectable: true,
      source: "sdk",
    };
  }

  // Android allows only one UiAutomationService. An active agent-device
  // session owns it, so launching a separate `uiautomator dump` is rejected by
  // Android and produces an empty tree. Read lock state independently, then
  // prefer the hierarchy from the session that already owns automation.
  const inspectionState = await captureAndroidInspectionState(target.context.serial);
  const foregroundApp = await captureAndroidForegroundApp(target.context.serial);
  if (inspectionState !== "active") {
    return {
      nodes: [],
      inspectable: false,
      source: "android-system",
      inspectionState,
      foregroundApp,
      bindingState: "unavailable",
    };
  }

  try {
    let nodes = await snapshotThroughSdk(target.device, interactiveOnly);
    let treeApp = androidSnapshotApplication(nodes);
    if (nodes.length > 0 && androidSnapshotMatchesForeground(nodes, foregroundApp)) {
      return {
        nodes,
        inspectable: true,
        source: "sdk",
        inspectionState,
        foregroundApp,
        treeApp,
        bindingState: "matched",
      };
    }
    if (foregroundApp && treeApp && foregroundApp !== treeApp) {
      await target.device.apps.open({
        platform: "android",
        serial: target.context.serial,
        app: foregroundApp,
        relaunch: false,
        noRecord: true,
      });
      nodes = await snapshotThroughSdk(target.device, interactiveOnly);
      treeApp = androidSnapshotApplication(nodes);
      if (nodes.length > 0 && androidSnapshotMatchesForeground(nodes, foregroundApp)) {
        return {
          nodes,
          inspectable: true,
          source: "sdk",
          inspectionState,
          foregroundApp,
          treeApp,
          bindingState: "rebound",
        };
      }
    }
  } catch {
    // A session is optional for manual mirroring. If it is unavailable, the
    // dependency-free system provider still works when no other automation
    // client owns Android's service.
  }

  const snapshot = await captureAndroidUiSnapshotWithState(target.context.serial);
  return {
    ...snapshot,
    inspectable: snapshot.inspectionState === "active" && snapshot.nodes.length > 0,
    source: "android-system",
    foregroundApp,
    treeApp: androidSnapshotApplication(snapshot.nodes),
    bindingState: "unavailable",
  };
}

export async function captureSnapshot(opts?: {
  serial?: string;
  interactiveOnly?: boolean;
  device?: Device;
}): Promise<SnapshotPayload> {
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
    let snapshot: SnapshotCapture;
    try {
      snapshot = await snapshotForTarget(target, opts?.interactiveOnly ?? false);
    } catch (error) {
      if (target.context.kind === "device" && target.context.platform === "ios") {
        const normalized = await diagnoseIosRunnerError(error, target.context.serial);
        throw normalized;
      }
      throw error;
    }
    const { nodes: capturedNodes, ...capture } = snapshot;
    const context = target.context;
    const iosGeometry =
      context.kind === "device" && context.platform === "ios"
        ? inferIosSnapshotGeometry(capturedNodes)
        : undefined;
    const nodes = iosGeometry
      ? normalizeIosSnapshotNodes(capturedNodes, iosGeometry)
      : capturedNodes;
    if (context.kind === "device" && context.platform === "ios" && context.serial && iosGeometry) {
      iosSnapshotGeometryBySerial.set(context.serial, iosGeometry);
    }
    const interactive = nodes.filter((n) => n.hittable || n.enabled !== false);
    const bounds = inferSnapshotBounds(
      nodes,
      target.context.kind === "device" ? target.context.platform : undefined,
    );
    const serial = targetIdentity();
    publish({ type: "snapshot.captured", at: now(), serial, nodeCount: nodes.length });
    const observedIdentity = observeScreenIdentity(nodes);
    return {
      serial,
      capturedAt: now(),
      nodes,
      interactive,
      bounds,
      screenIdentity: observedIdentity,
      ...capture,
    };
  });
}

export type ScreenshotPayload = {
  serial?: string;
  capturedAt: number;
  mime: "image/png";
  base64: string;
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  foregroundApp?: string;
  screenMatch?: {
    fingerprint: string;
    matchedScreenId: string | null;
    status: "observed" | "unavailable";
  };
  jobId?: string;
  framePath?: string;
};

export async function captureScreenshot(opts?: {
  serial?: string;
  device?: Device;
  caption?: string;
  jobId?: string;
  /** skip attaching to job */
  ephemeral?: boolean;
  /** skip the additional semantic snapshot when the caller only needs pixels */
  includeScreenMatch?: boolean;
}): Promise<ScreenshotPayload> {
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
    const foregroundApp =
      target.context.kind === "device" &&
      target.context.platform === "android" &&
      target.context.serial
        ? await captureAndroidForegroundApp(target.context.serial)
        : undefined;
    const parent = join(tmpdir(), "relay");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(parent, "shot-"));
    const path = join(dir, "capture.png");
    const context = currentTargetContext();
    if (context.kind === "device" && context.platform === "android") {
      // Mirroring is device-scoped, not app-scoped. Going directly through adb
      // avoids the SDK's long retry path when its optional app session expires.
      rawScreenshot(path, context.serial);
    } else {
      try {
        if (context.kind === "device" && context.platform === "ios" && context.serial) {
          await ensureIosRunnerPrepared(target.device, context.serial);
        }
        await withSession(target.device, () =>
          target.device.capture.screenshot({ ...base(), path }),
        );
      } catch (error) {
        if (context.kind === "device" && context.platform === "ios") {
          const normalized = await diagnoseIosRunnerError(error, context.serial);
          throw normalized;
        }
        throw error;
      }
    }
    let buf = await readFile(path);
    let semanticNodes: SnapshotNode[] | undefined;
    if (context.kind === "device" && context.platform === "ios" && context.serial) {
      let geometry = iosSnapshotGeometryBySerial.get(context.serial);
      if (!geometry) {
        try {
          semanticNodes = (await snapshotForTarget(target, false)).nodes;
          geometry = inferIosSnapshotGeometry(semanticNodes);
          if (geometry) iosSnapshotGeometryBySerial.set(context.serial, geometry);
        } catch {
          // A screenshot remains useful when semantic inspection is temporarily unavailable.
        }
      }
      if (geometry) {
        const normalized = normalizeScreenshotToBounds(buf, {
          width: geometry.logicalWidth,
          height: geometry.logicalHeight,
        });
        if (normalized !== buf) {
          buf = Buffer.from(normalized);
          await writeFile(path, buf);
        }
      }
    }
    const base64 = buf.toString("base64");
    const dimensions = pngDimensions(buf);
    let screenMatch: ScreenshotPayload["screenMatch"];
    if (opts?.includeScreenMatch !== false) {
      try {
        semanticNodes ??= (await snapshotForTarget(target, false)).nodes;
        const identity = observeScreenIdentity(semanticNodes);
        if (identity.fingerprint) {
          screenMatch = {
            fingerprint: identity.fingerprint,
            matchedScreenId: null,
            status: "observed",
          };
        }
      } catch {
        screenMatch = undefined;
      }
    }
    const serial = targetIdentity();
    publish({ type: "screenshot.captured", at: now(), serial, bytes: buf.byteLength });

    let framePath: string | undefined;
    let jobId = opts?.jobId;
    if (!opts?.ephemeral) {
      const active = opts?.jobId ? { id: opts.jobId } : getActiveJob(serial);
      if (active) {
        const frame = await attachJobFrame({
          jobId: active.id,
          base64,
          caption: opts?.caption ?? `screenshot · ${new Date().toISOString()}`,
        });
        framePath = frame?.path;
        jobId = active.id;
      }
    }

    return {
      serial,
      capturedAt: now(),
      mime: "image/png",
      base64,
      path,
      bytes: buf.byteLength,
      ...dimensions,
      ...(foregroundApp ? { foregroundApp } : {}),
      ...(screenMatch ? { screenMatch } : {}),
      jobId,
      framePath,
    };
  });
}

export type DeviceVideoCapture = {
  serial?: string;
  platform: DevicePlatform;
  mode: "recorded-video";
  path?: string;
  warning?: string;
};

/**
 * Capture an iOS review take through XCTest. It intentionally does not share
 * the Android H.264 stream path: a take is a durable video, not live preview.
 */
export async function captureDeviceVideo(input: {
  serial: string;
  action: "start" | "stop";
  path?: string;
}): Promise<DeviceVideoCapture> {
  const target = await resolveRuntimeTarget(input.serial);
  return runWithTargetContext(target.context, async () => {
    const context = currentTargetContext();
    if (context.kind !== "device" || context.platform !== "ios") {
      throw new Error("Recorded video capture is currently available for Apple devices only");
    }
    const serial = context.serial;
    if (!serial) throw new Error("Choose an iPhone or iPad before recording video");
    if (input.action === "start") {
      await ensureIosRunnerPrepared(target.device, serial);
    }
    const recorded = await withSession(target.device, () =>
      recordIosVideo(target.device, {
        udid: serial,
        action: input.action,
        ...(input.path ? { path: input.path } : {}),
      }),
    );
    return { serial, platform: context.platform, ...recorded };
  });
}

/** Remove only the private temporary directory produced by captureScreenshot. */
export async function cleanupScreenshot(path: string): Promise<void> {
  const root = resolve(tmpdir(), "relay");
  const directory = resolve(dirname(path));
  if (!directory.startsWith(`${root}/`) || !dirname(directory).startsWith(root)) return;
  await rm(directory, { recursive: true, force: true });
}

export type InteractInput =
  | { kind: "identifier"; identifier: string }
  | { kind: "label"; label: string }
  | { kind: "point"; x: number; y: number }
  | { kind: "ref"; ref: string }
  | { kind: "find"; query: string }
  | { kind: "text-match"; match: string }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
    }
  | { kind: "type"; text: string };

export async function interact(input: InteractInput, opts?: { serial?: string }): Promise<void> {
  const target = await resolveRuntimeTarget(opts?.serial);
  await runWithTargetContext(target.context, async () => {
    const context = currentTargetContext();
    if (context.kind === "device" && context.platform === "android") {
      // Direct manipulation should survive app/session changes. Semantic refs
      // still use the SDK below, but mirror gestures never need an active app.
      if (input.kind === "point") {
        rawTap(input.x, input.y, context.serial);
        return;
      }
      if (input.kind === "swipe") {
        rawSwipe(input.from, input.to, input.durationMs ?? 250, context.serial);
        return;
      }
    }
    try {
      await withSession(target.device, async () => {
        switch (input.kind) {
          case "identifier":
            await pressIdentifier(target.device, input.identifier);
            return;
          case "label":
            await pressLabel(target.device, input.label);
            return;
          case "point":
            await pressPoint(target.device, input.x, input.y);
            return;
          case "ref":
            await pressRef(target.device, input.ref);
            return;
          case "find":
            await findClick(target.device, input.query);
            return;
          case "text-match":
            await pressMatchingText(target.device, input.match);
            return;
          case "swipe":
            await swipeGesture(target.device, input.from, input.to, input.durationMs ?? 250);
            return;
          case "type":
            await typeText(target.device, input.text);
            return;
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const context = currentTargetContext();
      // No SDK session — raw adb works for coordinate interactions on any app.
      if (
        /no active session/i.test(msg) &&
        context.kind === "device" &&
        context.platform === "android" &&
        input.kind === "point"
      ) {
        rawTap(input.x, input.y, context.serial);
        return;
      }
      if (
        /no active session/i.test(msg) &&
        context.kind === "device" &&
        context.platform === "android" &&
        input.kind === "swipe"
      ) {
        rawSwipe(input.from, input.to, input.durationMs ?? 250, context.serial);
        return;
      }
      throw err;
    }
  });
}

export function formatSnapshotTree(nodes: SnapshotNode[], limit = 80): string {
  const lines: string[] = [];
  for (const n of nodes.slice(0, limit)) {
    const label = (n.label ?? n.value ?? n.identifier ?? "").trim();
    if (!label) continue;
    const hit = n.hittable ? "●" : "○";
    const rect = n.rect
      ? ` @${Math.round(n.rect.x)},${Math.round(n.rect.y)} ${Math.round(n.rect.width)}×${Math.round(n.rect.height)}`
      : "";
    const ref = n.ref ? ` ${n.ref.startsWith("@") ? n.ref : `@${n.ref}`}` : "";
    lines.push(`${hit} ${label}${ref}${rect}`);
  }
  if (nodes.length > limit) lines.push(`… ${nodes.length - limit} more nodes`);
  return lines.join("\n");
}

export { center };
