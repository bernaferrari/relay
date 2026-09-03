/**
 * Environment / toolchain checks for app testing (PostHog/Uber bar).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listAdbDevices } from "./adb-devices.js";
import {
  AndroidSdkRootConfigurationError,
  AndroidSdkToolError,
  resolveAndroidSdkTool,
} from "./android-sdk-tools.js";
import { listDevices } from "./workspace.js";

const execFileAsync = promisify(execFile);

export type DoctorCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type DoctorResult = {
  ok: boolean;
  checks: DoctorCheck[];
};

const MIN_NODE_MAJOR = 22;

async function checkNode(): Promise<DoctorCheck> {
  const version = process.versions.node;
  const major = Number(version.split(".")[0] ?? 0);
  const ok = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  return {
    id: "node",
    ok,
    message: ok
      ? `Node.js ${version} (>= ${MIN_NODE_MAJOR} required)`
      : `Node.js ${version} is below minimum ${MIN_NODE_MAJOR}`,
  };
}

async function checkAdb(): Promise<DoctorCheck> {
  try {
    const { stdout, stderr } = await execFileAsync(
      await resolveAndroidSdkTool("adb"),
      ["version"],
      {
        timeout: 8_000,
        maxBuffer: 64 * 1024,
      },
    );
    const text = `${stdout}\n${stderr}`.trim().split("\n")[0] ?? "adb present";
    return {
      id: "adb",
      ok: true,
      message: text || "adb is available on PATH",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing =
      err instanceof AndroidSdkToolError ||
      err instanceof AndroidSdkRootConfigurationError ||
      (err as NodeJS.ErrnoException)?.code === "ENOENT" ||
      /not found|ENOENT/i.test(message);
    return {
      id: "adb",
      ok: false,
      message: missing
        ? message || "Android SDK adb is unavailable (install Android platform-tools)"
        : `adb version failed: ${message}`,
    };
  }
}

type DoctorListedDevice = {
  name: string;
  serial: string;
  platform: string;
};

type DoctorAdbDevice = {
  name: string;
  connectionState: string;
};

/** Pure device-visibility check so iOS-only and Android-only setups both pass. */
export function devicesDoctorCheck(
  devices: readonly DoctorListedDevice[],
  adbDevices: readonly DoctorAdbDevice[] = [],
): DoctorCheck {
  const unauthorized = adbDevices.filter((device) => device.connectionState === "unauthorized");
  const offline = adbDevices.filter((device) => device.connectionState === "offline");
  const count = devices.length;

  if (count === 0 && unauthorized.length > 0) {
    return {
      id: "devices",
      ok: false,
      message:
        `Android device detected but authorization is pending (${unauthorized.map((device) => device.name).join(", ")}). ` +
        "Unlock the phone and approve the USB debugging dialog, then run relay device list.",
    };
  }

  if (count === 0 && offline.length > 0) {
    return {
      id: "devices",
      ok: false,
      message:
        `Android device is offline (${offline.map((device) => device.name).join(", ")}). ` +
        "Reconnect the phone or restart wireless debugging, then run relay device list.",
    };
  }

  if (count === 0) {
    return {
      id: "devices",
      ok: false,
      message:
        "No device is visible. Connect an Android phone (USB debugging) or an iPhone/iPad " +
        "(trusted, unlocked, Developer Mode), then run relay device list.",
    };
  }
  const summary = devices
    .slice(0, 5)
    .map((d) => `${d.name} (${d.platform}, ${d.serial})`)
    .join(", ");
  const more = count > 5 ? ` +${count - 5} more` : "";
  const noise = [
    unauthorized.length
      ? `ADB authorization pending (${unauthorized.map((device) => device.name).join(", ")})`
      : "",
    offline.length ? `ADB offline (${offline.map((device) => device.name).join(", ")})` : "",
  ].filter(Boolean);
  return {
    id: "devices",
    ok: true,
    message: `${count} device(s): ${summary}${more}${noise.length ? `. Note: ${noise.join("; ")}` : ""}`,
  };
}

export type DoctorRuntime = {
  listDevices?: () => Promise<readonly DoctorListedDevice[]>;
  listAdbDevices?: () => Promise<readonly DoctorAdbDevice[]>;
  adbVersion?: () => Promise<DoctorCheck>;
  node?: () => Promise<DoctorCheck>;
};

async function loadDoctorDevices(
  runtime: DoctorRuntime,
): Promise<{ listed: readonly DoctorListedDevice[]; check: DoctorCheck }> {
  try {
    const listed = await (runtime.listDevices ?? listDevices)();
    const adbDevices = await (runtime.listAdbDevices ?? listAdbDevices)();
    return { listed, check: devicesDoctorCheck(listed, adbDevices) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      listed: [],
      check: {
        id: "devices",
        ok: false,
        message: `listDevices failed: ${message}`,
      },
    };
  }
}

/** Compact failure text for CLI/HTTP clients that only read `error`. */
export function doctorFailureMessage(result: DoctorResult): string | undefined {
  if (result.ok) return undefined;
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.message);
  return failed.length ? failed.join("; ") : "Doctor checks failed";
}

function androidVisible(devices: readonly DoctorListedDevice[]): boolean {
  return devices.some((device) => device.platform === "android");
}

function adbBlocksDoctor(adb: DoctorCheck, listedAndroid: boolean): boolean {
  if (adb.ok) return false;
  if (listedAndroid) return true;
  return !/(?:adb not found on PATH|Android SDK tool\s+"?adb"?\s+is unavailable|Android SDK configuration is ambiguous)/i.test(
    adb.message,
  );
}

export function doctorResultFromChecks(
  node: DoctorCheck,
  adb: DoctorCheck,
  devices: DoctorCheck,
  listed: readonly DoctorListedDevice[] = [],
): DoctorResult {
  const checks = [node, adb, devices];
  return {
    ok: node.ok && devices.ok && !adbBlocksDoctor(adb, androidVisible(listed)),
    checks,
  };
}

/** Run local toolchain checks. Does not require the HTTP server. */
export async function runDoctor(runtime: DoctorRuntime = {}): Promise<DoctorResult> {
  const [{ listed, check: devices }, node, adb] = await Promise.all([
    loadDoctorDevices(runtime),
    (runtime.node ?? checkNode)(),
    (runtime.adbVersion ?? checkAdb)(),
  ]);
  return doctorResultFromChecks(node, adb, devices, listed);
}
