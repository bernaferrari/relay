/**
 * Live device workspace helpers for the testing shell:
 * snapshot UI tree, screenshot, basic interactions.
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  pressLabel,
  pressMatchingText,
  pressPoint,
  pressRef,
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
import {
  listAdbDevices,
  type AndroidConnectionState,
  type AdbDeviceObservation,
} from "./adb-devices.js";
import {
  captureAndroidUiSnapshotWithState,
  type AndroidInspectionState,
} from "./android-ui-snapshot.js";
import {
  configuredTargetContext,
  currentTargetContext,
  runWithTargetContext,
  targetIdentity,
  type TargetContext,
} from "./target-context.js";
import { adbSwipeInputArgs } from "./adb-input.js";

/**
 * Recover from session binding conflicts by releasing the stale binding
 * and retrying. Does NOT auto-open any app — each recipe opens its own.
 */
async function withSession<T>(device: Device, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already bound/i.test(msg) && !getExecutingJobId()) {
      await hardStopDeviceSession().catch(() => undefined);
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
  serial ??= process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  const args = serial
    ? ["-s", serial, "exec-out", "screencap", "-p"]
    : ["exec-out", "screencap", "-p"];
  const buf = execFileSync("adb", args, { maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(path, buf);
}

/** Raw adb input tap — works without a session, on any app. */
function rawTap(x: number, y: number, serial?: string): void {
  serial ??= process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  const args = serial
    ? ["-s", serial, "shell", "input", "tap", String(x), String(y)]
    : ["shell", "input", "tap", String(x), String(y)];
  execFileSync("adb", args, { timeout: 5000 });
}
/** Raw adb input swipe — works without a session, on any app. */
function rawSwipe(
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
  serial?: string,
): void {
  serial ??= process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  const inputArgs = adbSwipeInputArgs(from, to, durationMs);
  const args = serial ? ["-s", serial, "shell", ...inputArgs] : ["shell", ...inputArgs];
  execFileSync("adb", args, { timeout: 8000 });
}

/** Raw adb text input — keeps manual mirroring alive without an SDK app session. */
function rawType(text: string, serial?: string): void {
  serial ??= process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  const encoded = text.replaceAll(" ", "%s");
  const args = serial
    ? ["-s", serial, "shell", "input", "text", encoded]
    : ["shell", "input", "text", encoded];
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
};

const execFileAsync = promisify(execFile);

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
  const client = createDevice();
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
      }, 2_000);
    }),
  ]);
  const [adapterResult, adbDevices] = await Promise.all([adapterList, listAdbDevices()]);
  if (adapterResult.error && adbDevices.length === 0) throw adapterResult.error;

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

  const merged = [...bySerial.values()].sort((left, right) => {
    const rank = (device: ListedDevice) =>
      device.kind === "Physical device" ? 0 : device.booted !== false ? 1 : 2;
    return rank(left) - rank(right);
  });
  publish({ type: "device.list", at: now(), count: merged.length });
  return merged;
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
  const client = createDevice();
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

export function selectDevice(serial: string | null, platform: DevicePlatform = "android"): void {
  delete process.env.RELAY_TARGET_ID;
  if (serial?.trim()) {
    process.env.AGENT_DEVICE_SERIAL = serial.trim();
    process.env.AGENT_DEVICE_PLATFORM = platform;
    if (platform === "android") process.env.ANDROID_SERIAL = serial.trim();
    else delete process.env.ANDROID_SERIAL;
  } else {
    delete process.env.AGENT_DEVICE_SERIAL;
    delete process.env.ANDROID_SERIAL;
    delete process.env.AGENT_DEVICE_PLATFORM;
  }
  publish({ type: "device.selected", at: now(), serial: serial?.trim() || null });
}

export function selectBrowserTarget(targetId: string | null): void {
  delete process.env.AGENT_DEVICE_SERIAL;
  delete process.env.ANDROID_SERIAL;
  delete process.env.AGENT_DEVICE_PLATFORM;
  if (targetId?.trim()) process.env.RELAY_TARGET_ID = targetId.trim();
  else delete process.env.RELAY_TARGET_ID;
  publish({ type: "device.selected", at: now(), serial: targetId?.trim() || null });
}

async function resolveRuntimeTarget(
  serial?: string,
  provided?: Device,
): Promise<{ context: TargetContext; device: Device }> {
  if (provided) return { context: currentTargetContext(), device: provided };
  if (serial) {
    if (await readTarget(serial)) {
      return {
        context: { kind: "browser", platform: "browser", targetId: serial },
        device: await getBrowserDevice(serial),
      };
    }
    const configured = configuredTargetContext();
    const platform = configured.kind === "device" ? configured.platform : "android";
    return {
      context: { kind: "device", platform, serial },
      device: createDevice(),
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
};

function inferBounds(nodes: SnapshotNode[]): { width: number; height: number } | undefined {
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
  "nodes" | "inspectable" | "source" | "inspectionState"
>;

async function snapshotForTarget(
  target: Awaited<ReturnType<typeof resolveRuntimeTarget>>,
  interactiveOnly: boolean,
): Promise<SnapshotCapture> {
  if (
    target.context.kind !== "device" ||
    target.context.platform !== "android" ||
    !target.context.serial
  ) {
    return {
      nodes: await snapshotThroughSdk(target.device, interactiveOnly),
      inspectable: true,
      source: "sdk",
    };
  }

  // An app-bound SDK snapshot can retain Always-On Display or app content while
  // the lock screen owns the pixels. This system provider exposes that state
  // explicitly so the renderer clears inspection instead of guessing.
  const snapshot = await captureAndroidUiSnapshotWithState(target.context.serial);
  return {
    ...snapshot,
    inspectable: snapshot.inspectionState === "active",
    source: "android-system",
  };
}

export async function captureSnapshot(opts?: {
  serial?: string;
  interactiveOnly?: boolean;
  device?: Device;
}): Promise<SnapshotPayload> {
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
    const snapshot = await snapshotForTarget(target, opts?.interactiveOnly ?? false);
    const { nodes, ...capture } = snapshot;
    const interactive = nodes.filter((n) => n.hittable || n.enabled !== false);
    const bounds = inferBounds(nodes);
    const serial = targetIdentity();
    publish({ type: "snapshot.captured", at: now(), serial, nodeCount: nodes.length });
    return { serial, capturedAt: now(), nodes, interactive, bounds, ...capture };
  });
}

export type ScreenshotPayload = {
  serial?: string;
  capturedAt: number;
  mime: "image/png";
  base64: string;
  path: string;
  bytes: number;
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
}): Promise<ScreenshotPayload> {
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device);
  return runWithTargetContext(target.context, async () => {
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
      await withSession(target.device, () => target.device.capture.screenshot({ ...base(), path }));
    }
    const buf = await readFile(path);
    const base64 = buf.toString("base64");
    const serial = targetIdentity();
    publish({ type: "screenshot.captured", at: now(), serial, bytes: buf.byteLength });

    let framePath: string | undefined;
    let jobId = opts?.jobId;
    if (!opts?.ephemeral) {
      const active = opts?.jobId ? { id: opts.jobId } : getActiveJob();
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
      jobId,
      framePath,
    };
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
      if (input.kind === "type") {
        rawType(input.text, context.serial);
        return;
      }
    }
    try {
      await withSession(target.device, async () => {
        switch (input.kind) {
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
