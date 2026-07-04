/**
 * Environment / toolchain checks for app testing (PostHog/Uber bar).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
    const devices = await listDevices();
    const count = devices.length;
    if (count === 0) {
      return {
        id: "devices",
        ok: false,
        message: "No Android devices listed (connect a device or start an emulator)",
      };
    }
    const summary = devices
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
