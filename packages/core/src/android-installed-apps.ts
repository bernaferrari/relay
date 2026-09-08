import { listAndroidAppsWithAdb, type AndroidAdbExecutor } from "agent-device/android-adb";
import { execAndroidAdb } from "./android-adb-host.js";

/** Read launchable apps on an attached local Android target. Discovery never
 * launches a package or changes the current screen. */
export async function listAndroidInstalledApps(
  serial: string,
  execute: typeof execAndroidAdb = execAndroidAdb,
): Promise<Array<{ package: string; name: string }>> {
  if (
    !serial.trim() ||
    serial.startsWith("-") ||
    serial.includes(String.fromCharCode(0)) ||
    /\s/u.test(serial)
  ) {
    throw new Error("A connected Android device serial is required");
  }
  const adb: AndroidAdbExecutor = async (args) => {
    // Discovery failures must remain failures, not a misleading empty list.
    const result = await execute(["-s", serial, ...args], {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutBuffer: Buffer.from(result.stdout),
    };
  };
  return listAndroidAppsWithAdb(adb, { target: "mobile", filter: "all" });
}
