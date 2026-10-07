import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ANDROID_SNAPSHOT_HELPER_PACKAGE = "com.callstack.agentdevice.snapshothelper";
export const ANDROID_SNAPSHOT_HELPER_COMPONENT = `${ANDROID_SNAPSHOT_HELPER_PACKAGE}/.SnapshotInstrumentation`;

export type AndroidSnapshotHelperBundle = {
  apkPath: string;
  version: string;
  versionCode: number;
  sha256: string;
};
export type SnapshotHelperAdb = (
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string | Buffer }>;

/** Only one manifest-selected, hash-verified snapshot helper may be bundled.
 * Never choose the first APK from a directory containing multiple versions. */
export async function bundledAndroidSnapshotHelper(
  directories = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "android-helpers"),
    join(dirname(fileURLToPath(import.meta.url)), "android-helpers"),
  ],
): Promise<AndroidSnapshotHelperBundle | undefined> {
  for (const directory of directories) {
    let foundBundle = false;
    try {
      const files = await readdir(directory);
      const manifests = files.filter((name) =>
        /^agent-device-android-snapshot-helper-[\d.]+\.manifest\.json$/u.test(name),
      );
      const apks = files.filter((name) =>
        /^agent-device-android-snapshot-helper-.*\.apk$/u.test(name),
      );
      foundBundle = manifests.length > 0 || apks.length > 0;
      if (manifests.length !== 1 || apks.length !== 1) {
        if (manifests.length || apks.length) return undefined;
        continue;
      }
      const manifest = JSON.parse(await readFile(join(directory, manifests[0]!), "utf8"));
      if (
        manifest.name !== "android-snapshot-helper" ||
        typeof manifest.version !== "string" ||
        !/^\d+\.\d+\.\d+$/u.test(manifest.version) ||
        manifest.assetName !== `agent-device-android-snapshot-helper-${manifest.version}.apk` ||
        manifest.assetName !== apks[0] ||
        manifest.packageName !== ANDROID_SNAPSHOT_HELPER_PACKAGE ||
        manifest.instrumentationRunner !== ANDROID_SNAPSHOT_HELPER_COMPONENT ||
        manifest.statusProtocol !== "android-snapshot-helper-v1" ||
        manifest.outputFormat !== "uiautomator-xml" ||
        !Number.isSafeInteger(manifest.versionCode) ||
        manifest.versionCode <= 0 ||
        typeof manifest.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(manifest.sha256)
      )
        return undefined;
      const apkPath = join(directory, manifest.assetName);
      if (
        createHash("sha256")
          .update(await readFile(apkPath))
          .digest("hex") !== manifest.sha256
      )
        return undefined;
      return {
        apkPath,
        version: manifest.version,
        versionCode: manifest.versionCode,
        sha256: manifest.sha256,
      };
    } catch {
      if (foundBundle) return undefined;
      // Source checkouts and packaged servers use different asset roots.
    }
  }
  return undefined;
}

export async function androidSnapshotHelperInstalled(
  serial: string,
  execute: SnapshotHelperAdb,
): Promise<boolean> {
  try {
    const { stdout } = await execute(
      ["-s", serial, "shell", "pm", "path", ANDROID_SNAPSHOT_HELPER_PACKAGE],
      { timeout: 2_000, maxBuffer: 16 * 1024 },
    );
    return stdout.toString().includes("package:");
  } catch {
    return false;
  }
}

async function matchesInstalledHelper(
  serial: string,
  helper: AndroidSnapshotHelperBundle,
  execute: SnapshotHelperAdb,
): Promise<boolean> {
  try {
    const { stdout } = await execute(
      ["-s", serial, "shell", "dumpsys", "package", ANDROID_SNAPSHOT_HELPER_PACKAGE],
      { timeout: 2_000, maxBuffer: 256 * 1024 },
    );
    const dump = stdout.toString();
    return (
      /^\s*versionName=(\S+)\s*$/mu.exec(dump)?.[1] === helper.version &&
      Number(/\bversionCode=(\d+)\b/u.exec(dump)?.[1]) === helper.versionCode
    );
  } catch {
    return false;
  }
}

const installs = new Map<string, Promise<boolean>>();

/** A present old helper is not the current runtime. Update once and verify
 * the installed version before requesting its UiAutomation observation. */
export async function ensureAndroidSnapshotHelperInstalled(
  serial: string,
  execute: SnapshotHelperAdb,
  helper?: AndroidSnapshotHelperBundle,
): Promise<boolean> {
  if (!helper) return false;
  const key = `${serial}:${helper.sha256}`;
  const pending = installs.get(key);
  if (pending) return pending;
  const install = (async () => {
    if (await matchesInstalledHelper(serial, helper, execute)) return true;
    try {
      await execute(["-s", serial, "install", "-r", "-t", helper.apkPath], {
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      });
      return await matchesInstalledHelper(serial, helper, execute);
    } catch {
      return false;
    }
  })();
  installs.set(key, install);
  try {
    return await install;
  } finally {
    if (installs.get(key) === install) installs.delete(key);
  }
}
