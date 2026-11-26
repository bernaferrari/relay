import { listAndroidAppsWithAdb, type AndroidAdbExecutor } from "agent-device/android-adb";
import { execAndroidAdb } from "./android-adb-host.js";
import { readAndroidApplicationLabels } from "./android-app-inventory.js";

/** Read launchable apps on an attached local Android target. Discovery never
 * launches a listed app or changes the screen. A metadata helper is prepared
 * when necessary to observe the device's application labels. */
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
  const apps = await listAndroidAppsWithAdb(adb, { target: "mobile", filter: "all" });
  if (!apps.length) return apps;
  const labels = await readAndroidApplicationLabels(serial, execute);
  return labels ? apps.map((app) => ({ ...app, name: labels.get(app.package) ?? app.name })) : apps;
}
