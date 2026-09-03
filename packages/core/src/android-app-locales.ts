import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setAndroidAppLocale, type SetAndroidAppLocaleOptions } from "./android-app-build.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";
import { runWithTargetContext } from "./target-context.js";

const execFileAsync = promisify(execFile);
const MAX_APK_TOOL_OUTPUT = 64 * 1024 * 1024;

function validPackageName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function parseAndroidLocaleConfig(input: {
  manifest: string;
  resources: string;
  localeXml: string;
}): string[] {
  const resourceId = input.manifest.match(/android:localeConfig[^\n]*=@(0x[0-9a-f]+)/i)?.[1];
  if (!resourceId) return [];
  const escaped = resourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const resourceName = input.resources.match(
    new RegExp(`resource\\s+${escaped}\\s+xml\\/([A-Za-z0-9_.-]+)`, "i"),
  )?.[1];
  if (!resourceName) return [];
  const tags = [...input.localeXml.matchAll(/android:name[^\n]*Raw:\s*"([^"]+)"/g)].map(
    (match) => match[1]!,
  );
  return [...new Set(tags.filter((tag) => /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag)))];
}

/** Read the locale list the installed Android app itself declares. No product
 * preset is involved; any package using Android's LocaleConfig can reuse it. */
export async function listAndroidAppLocales(
  serial: string,
  packageName: string,
): Promise<string[]> {
  if (!serial.trim()) throw new Error("device serial is required");
  if (!validPackageName(packageName))
    throw new Error("app package name contains unsupported characters");
  const aapt2 = await resolveAndroidSdkTool("aapt2");
  const adb = await resolveAndroidSdkTool("adb");
  const workspace = await mkdtemp(path.join(tmpdir(), "relay-app-locales-"));
  const apk = path.join(workspace, "base.apk");
  try {
    const { stdout: packagePaths } = await execFileAsync(
      adb,
      ["-s", serial, "shell", "pm", "path", packageName],
      { maxBuffer: MAX_APK_TOOL_OUTPUT },
    );
    const remoteApk = String(packagePaths)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("package:") && line.endsWith("/base.apk"))
      ?.slice("package:".length);
    if (!remoteApk) throw new Error(`${packageName} is not installed on ${serial}`);
    await execFileAsync(adb, ["-s", serial, "pull", remoteApk, apk], {
      maxBuffer: MAX_APK_TOOL_OUTPUT,
    });
    const runAapt = async (args: string[]) =>
      String(
        (
          await execFileAsync(aapt2, args, {
            maxBuffer: MAX_APK_TOOL_OUTPUT,
          })
        ).stdout,
      );
    const manifest = await runAapt(["dump", "xmltree", "--file", "AndroidManifest.xml", apk]);
    const resources = await runAapt(["dump", "resources", apk]);
    const resourceId = manifest.match(/android:localeConfig[^\n]*=@(0x[0-9a-f]+)/i)?.[1];
    if (!resourceId) return [];
    const escaped = resourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const resourceName = resources.match(
      new RegExp(`resource\\s+${escaped}\\s+xml\\/([A-Za-z0-9_.-]+)`, "i"),
    )?.[1];
    if (!resourceName) return [];
    const localeXml = await runAapt([
      "dump",
      "xmltree",
      "--file",
      `res/xml/${resourceName}.xml`,
      apk,
    ]);
    return parseAndroidLocaleConfig({ manifest, resources, localeXml });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Apply one per-app locale on a specific connected Android device and report
 * the locale Android read back after the change (he/iw and id/in aliases are
 * retried by the underlying setter). Rejects when the locale never takes. */
export async function setAndroidAppLocaleOnDevice(
  serial: string,
  packageName: string,
  locale: string,
  options: SetAndroidAppLocaleOptions = {},
): Promise<string | undefined> {
  if (!serial.trim()) throw new Error("device serial is required");
  if (!validPackageName(packageName))
    throw new Error("app package name contains unsupported characters");
  return runWithTargetContext({ kind: "device", platform: "android", serial }, () =>
    setAndroidAppLocale(packageName, locale, options),
  );
}
