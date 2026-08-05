/**
 * Environment / toolchain checks for app testing (PostHog/Uber bar).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listAdbDevices } from "./adb-devices.js";
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
    const { stdout, stderr } = await execFileAsync("adb", ["version"], {
      timeout: 8_000,
      maxBuffer: 64 * 1024,
    });
    const text = `${stdout}\n${stderr}`.trim().split("\n")[0] ?? "adb present";
    return {
      id: "adb",
      ok: true,
      message: text || "adb is available on PATH",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing =
      (err as NodeJS.ErrnoException)?.code === "ENOENT" || /not found|ENOENT/i.test(message);
    return {
      id: "adb",
      ok: false,
      message: missing
        ? "adb not found on PATH (install Android platform-tools)"
        : `adb version failed: ${message}`,
    };
  }
}

async function checkDevices(): Promise<DoctorCheck> {
  try {
    const adbDevices = await listAdbDevices();
    const unauthorized = adbDevices.filter((device) => device.connectionState === "unauthorized");
    if (unauthorized.length > 0) {
      return {
        id: "devices",
        ok: false,
        message:
          `Android device detected but authorization is pending (${unauthorized.map((device) => device.name).join(", ")}). ` +
          "Unlock the phone and approve the USB debugging dialog, then run relay device list.",
      };
    }

    const offline = adbDevices.filter((device) => device.connectionState === "offline");
    if (offline.length > 0) {
      return {
        id: "devices",
        ok: false,
        message:
          `Android device is offline (${offline.map((device) => device.name).join(", ")}). ` +
          "Reconnect the phone or restart wireless debugging, then run relay device list.",
      };
    }

    const devices = await listDevices();
    const androidDevices = devices.filter((device) => device.platform === "android");
    const count = androidDevices.length;
    if (count === 0) {
      return {
        id: "devices",
        ok: false,
        message:
          "No Android device is visible to ADB. Connect and unlock the phone, enable USB debugging, " +
          "approve the USB debugging dialog, then run relay device list.",
      };
    }
    const summary = androidDevices
      .slice(0, 5)
      .map((d) => `${d.name} (${d.serial})`)
      .join(", ");
    const more = count > 5 ? ` +${count - 5} more` : "";
    return {
      id: "devices",
      ok: true,
      message: `${count} device(s): ${summary}${more}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "devices",
      ok: false,
      message: `listDevices failed: ${message}`,
    };
  }
}

/** Run local toolchain checks. Does not require the HTTP server. */
export async function runDoctor(): Promise<DoctorResult> {
  const checks = await Promise.all([checkNode(), checkAdb(), checkDevices()]);
  return {
    ok: checks.every((c) => c.ok),
    checks,
  };
}
