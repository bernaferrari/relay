/**
 * Explicit Android emulator (AVD) inventory and boot seam.
 *
 * AVD names are the configured identity. ADB serials are runtime observations
 * and are deliberately kept separate: a stopped AVD has no serial yet, and a
 * serial must never be guessed from a previous session.
 */
import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { probeAdbDevices, type AdbDeviceObservation } from "./adb-devices.js";

const execFileAsync = promisify(execFile);
const DEFAULT_BOOT_TIMEOUT_MS = 120_000;
const MAX_BOOT_TIMEOUT_MS = 300_000;
const COMMAND_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 500;

export type AndroidAvdStatus = "stopped" | "booting" | "booted";

export type AndroidAvdSummary = {
  /** Stable configured emulator identity, exactly as reported by the SDK. */
  avdName: string;
  /** Present only when ADB observed this exact AVD running. */
  serial?: string;
  name: string;
  platform: "android";
  kind: "emulator";
  target: "mobile" | "tv";
  booted: boolean;
  status: AndroidAvdStatus;
  source: "android-sdk";
};

export type AndroidAvdInventory = {
  source: "android-sdk" | "unavailable";
  available: boolean;
  avds: AndroidAvdSummary[];
  reason?: "sdk-unavailable" | "inventory-failed";
};

export type AndroidAvdBootResult = {
  avdName: string;
  serial: string;
  platform: "android";
  kind: "emulator";
  booted: true;
  status: "booted" | "already-booted";
  reused: boolean;
  observedAt: number;
};

export type AndroidAvdErrorCode =
  | "sdk-unavailable"
  | "inventory-failed"
  | "avd-not-found"
  | "avd-boot-in-progress"
  | "avd-boot-failed";

export class AndroidAvdError extends Error {
  readonly code: AndroidAvdErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: AndroidAvdErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AndroidAvdError";
    this.code = code;
    this.details = details;
  }
}

type AndroidAvdRuntime = {
  listAvdNames?: () => Promise<string[]>;
  listConnected?: () => Promise<AdbDeviceObservation[]>;
  readAvdName?: (serial: string) => Promise<string | undefined>;
  readBootCompleted?: (serial: string) => Promise<boolean>;
  launch?: (avdName: string, headless: boolean) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const configuredAvdBySerial = new Map<string, string>();
const activeBoots = new Set<string>();

async function resolveAndroidTool(tool: "adb" | "emulator"): Promise<string> {
  const fileName = process.platform === "win32" ? `${tool}.exe` : tool;
  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    join(homedir(), "Library", "Android", "sdk"),
    join(homedir(), "Android", "Sdk"),
  ].filter((value, index, values): value is string => {
    return Boolean(value?.trim()) && values.indexOf(value) === index;
  });
  for (const root of roots) {
    const candidate = join(root, tool === "emulator" ? "emulator" : "platform-tools", fileName);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next configured SDK root.
    }
  }
  return fileName;
}

function normalizeAvdName(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ");
}

function targetForAvd(avdName: string): "mobile" | "tv" {
  return /\b(?:tv|television)\b/iu.test(normalizeAvdName(avdName)) ? "tv" : "mobile";
}

export function parseAndroidAvdNames(rawOutput: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of rawOutput.split(/\r?\n/gu)) {
    const name = line.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function rememberAndroidAvd(serial: string, avdName: string): void {
  const normalizedSerial = serial.trim();
  const normalizedName = avdName.trim();
  if (normalizedSerial && normalizedName)
    configuredAvdBySerial.set(normalizedSerial, normalizedName);
}

export function androidAvdNameForSerial(serial: string): string | undefined {
  return configuredAvdBySerial.get(serial.trim());
}

export function resetAndroidAvdIdentityCache(): void {
  configuredAvdBySerial.clear();
}

async function defaultListAvdNames(): Promise<string[]> {
  try {
    const result = await execFileAsync(await resolveAndroidTool("emulator"), ["-list-avds"], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return parseAndroidAvdNames(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AndroidAvdError("sdk-unavailable", "Android emulator inventory is unavailable", {
      message: message.slice(0, 240),
    });
  }
}

async function defaultListConnected(): Promise<AdbDeviceObservation[]> {
  return (await probeAdbDevices()).devices.filter(
    (device) => device.kind === "Emulator" && device.connectionState === "connected",
  );
}

async function defaultReadAvdName(serial: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync(
      await resolveAndroidTool("adb"),
      ["-s", serial, "shell", "getprop", "ro.boot.qemu.avd_name"],
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4096 },
    );
    const value = result.stdout.trim();
    return value || androidAvdNameForSerial(serial);
  } catch {
    return androidAvdNameForSerial(serial);
  }
}

/** Observe the configured AVD behind one connected emulator serial. This is
 * used by normal target discovery so execution identity never depends on the
 * operator having opened the separate AVD inventory first. */
export async function observeAndroidAvdName(serial: string): Promise<string | undefined> {
  const avdName = await defaultReadAvdName(serial);
  if (avdName) rememberAndroidAvd(serial, avdName);
  return avdName;
}

async function defaultReadBootCompleted(serial: string): Promise<boolean> {
  try {
    const result = await execFileAsync(
      await resolveAndroidTool("adb"),
      ["-s", serial, "shell", "getprop", "sys.boot_completed"],
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4096 },
    );
    return result.stdout.trim() === "1";
  } catch {
    return false;
  }
}

async function defaultLaunch(avdName: string, headless: boolean): Promise<void> {
  const emulator = await resolveAndroidTool("emulator");
  await new Promise<void>((resolve, reject) => {
    const args = ["-avd", avdName];
    if (headless) args.push("-no-window", "-no-audio");
    const child = spawn(emulator, args, { detached: true, stdio: "ignore" });
    let settled = false;
    child.once("spawn", () => {
      settled = true;
      child.unref();
      resolve();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(
        new AndroidAvdError("sdk-unavailable", "Android emulator executable is unavailable", {
          message: error.message.slice(0, 240),
        }),
      );
    });
  });
}

function summary(avdName: string, serial: string | undefined, booted: boolean): AndroidAvdSummary {
  return {
    avdName,
    ...(serial ? { serial } : {}),
    name: avdName,
    platform: "android",
    kind: "emulator",
    target: targetForAvd(avdName),
    booted,
    status: booted ? "booted" : serial ? "booting" : "stopped",
    source: "android-sdk",
  };
}

async function runningAvdSerials(
  connected: readonly AdbDeviceObservation[],
  readAvdName: (serial: string) => Promise<string | undefined>,
): Promise<Map<string, string>> {
  const pairs = await Promise.all(
    connected.map(async (device) => {
      const avdName = await readAvdName(device.serial);
      if (!avdName) return undefined;
      rememberAndroidAvd(device.serial, avdName);
      return [normalizeAvdName(avdName), device.serial] as const;
    }),
  );
  return new Map(pairs.filter((pair): pair is readonly [string, string] => pair !== undefined));
}

export async function listAndroidAvds(
  runtime: AndroidAvdRuntime = {},
): Promise<AndroidAvdInventory> {
  const listAvdNames = runtime.listAvdNames ?? defaultListAvdNames;
  const listConnected = runtime.listConnected ?? defaultListConnected;
  const readAvdName = runtime.readAvdName ?? defaultReadAvdName;
  const readBootCompleted = runtime.readBootCompleted ?? defaultReadBootCompleted;
  let avdNames: string[];
  try {
    avdNames = await listAvdNames();
  } catch (error) {
    if (error instanceof AndroidAvdError && error.code === "sdk-unavailable") {
      return { source: "unavailable", available: false, avds: [], reason: "sdk-unavailable" };
    }
    return { source: "unavailable", available: false, avds: [], reason: "inventory-failed" };
  }

  let running = new Map<string, string>();
  try {
    running = await runningAvdSerials(await listConnected(), readAvdName);
  } catch {
    // The SDK list remains authoritative for configured AVDs. If ADB is down,
    // report them as stopped instead of claiming a runtime serial.
  }
  return {
    source: "android-sdk",
    available: true,
    avds: await Promise.all(
      avdNames.map(async (avdName) => {
        const serial = running.get(normalizeAvdName(avdName));
        const booted = serial ? await readBootCompleted(serial).catch(() => false) : false;
        return summary(avdName, serial, booted);
      }),
    ),
  };
}

async function waitForAvdBoot(
  avdName: string,
  runtime: Required<
    Pick<AndroidAvdRuntime, "listConnected" | "readAvdName" | "readBootCompleted" | "sleep" | "now">
  >,
  timeoutMs: number,
): Promise<string> {
  const startedAt = runtime.now();
  while (runtime.now() - startedAt < timeoutMs) {
    const connected = await runtime.listConnected().catch(() => []);
    for (const device of connected) {
      const observedName = await runtime.readAvdName(device.serial).catch(() => undefined);
      if (!observedName || normalizeAvdName(observedName) !== normalizeAvdName(avdName)) continue;
      rememberAndroidAvd(device.serial, observedName);
      if (await runtime.readBootCompleted(device.serial)) return device.serial;
    }
    await runtime.sleep(
      Math.min(POLL_INTERVAL_MS, Math.max(50, timeoutMs - (runtime.now() - startedAt))),
    );
  }
  throw new AndroidAvdError(
    "avd-boot-failed",
    `Android emulator "${avdName}" did not finish booting`,
    {
      avdName,
      timeoutMs,
    },
  );
}

/** Boot exactly one named AVD and return the observed ADB serial. */
export async function bootAndroidAvd(
  avdName: string,
  options: { timeoutMs?: number; headless?: boolean } = {},
  runtime: AndroidAvdRuntime = {},
): Promise<AndroidAvdBootResult> {
  const requested = avdName.trim();
  if (!requested) throw new AndroidAvdError("avd-not-found", "avdName is required");
  const timeoutMs = Math.min(
    MAX_BOOT_TIMEOUT_MS,
    Math.max(1_000, options.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS),
  );
  const listAvdNames = runtime.listAvdNames ?? defaultListAvdNames;
  const listConnected = runtime.listConnected ?? defaultListConnected;
  const readAvdName = runtime.readAvdName ?? defaultReadAvdName;
  const readBootCompleted = runtime.readBootCompleted ?? defaultReadBootCompleted;
  const sleep =
    runtime.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const launch = runtime.launch ?? defaultLaunch;
  const currentTime = runtime.now ?? Date.now;

  let avdNames: string[];
  try {
    avdNames = await listAvdNames();
  } catch (error) {
    if (error instanceof AndroidAvdError) throw error;
    throw new AndroidAvdError("inventory-failed", "Android emulator inventory failed");
  }
  if (!avdNames.includes(requested)) {
    throw new AndroidAvdError("avd-not-found", `No Android emulator AVD named "${requested}"`, {
      requestedAvdName: requested,
      availableAvds: avdNames,
    });
  }
  const lockKey = normalizeAvdName(requested);
  if (activeBoots.has(lockKey)) {
    throw new AndroidAvdError(
      "avd-boot-in-progress",
      `Android emulator "${requested}" is already booting`,
      {
        avdName: requested,
      },
    );
  }
  activeBoots.add(lockKey);
  try {
    const connected = await listConnected().catch(() => []);
    for (const device of connected) {
      const observedName = await readAvdName(device.serial).catch(() => undefined);
      if (!observedName || normalizeAvdName(observedName) !== lockKey) continue;
      rememberAndroidAvd(device.serial, observedName);
      if (await readBootCompleted(device.serial).catch(() => false)) {
        return {
          avdName: requested,
          serial: device.serial,
          platform: "android",
          kind: "emulator",
          booted: true,
          status: "already-booted",
          reused: true,
          observedAt: currentTime(),
        };
      }
    }
    await launch(requested, options.headless === true);
    const serial = await waitForAvdBoot(
      requested,
      { listConnected, readAvdName, readBootCompleted, sleep, now: currentTime },
      timeoutMs,
    );
    return {
      avdName: requested,
      serial,
      platform: "android",
      kind: "emulator",
      booted: true,
      status: "booted",
      reused: false,
      observedAt: currentTime(),
    };
  } finally {
    activeBoots.delete(lockKey);
  }
}
