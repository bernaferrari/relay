import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setAndroidAppLocale, type SetAndroidAppLocaleOptions } from "./android-app-build.js";
import { parseAndroidLocaleOutput } from "./android-locale-tags.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";
import { runWithTargetContext } from "./target-context.js";

const execFileAsync = promisify(execFile);
const MAX_APK_TOOL_OUTPUT = 64 * 1024 * 1024;
const MAX_LOCALE_CACHE_ENTRIES = 32;
const localeCache = new Map<string, string[]>();
type LocaleDiscoveryCommand = (
  file: string,
  args: readonly string[],
  options?: { maxBuffer?: number },
) => Promise<{ stdout?: string }>;
type LocaleDiscoveryToolResolver = (tool: "adb" | "aapt2") => Promise<string>;

export function androidLocaleCacheKey(input: {
  serial: string;
  packageName: string;
  baseApkPath: string;
  versionCode?: string;
  versionName?: string;
  lastUpdateTime?: string;
}): string {
  return JSON.stringify([
    input.serial,
    input.packageName,
    input.baseApkPath,
    input.versionCode ?? "",
    input.versionName ?? "",
    input.lastUpdateTime ?? "",
  ]);
}

function cachedLocales(key: string): string[] | undefined {
  const locales = localeCache.get(key);
  if (!locales) return undefined;
  localeCache.delete(key);
  localeCache.set(key, locales);
  return [...locales];
}

function cacheLocales(key: string, locales: string[]): void {
  localeCache.delete(key);
  localeCache.set(key, [...locales]);
  while (localeCache.size > MAX_LOCALE_CACHE_ENTRIES) {
    const oldest = localeCache.keys().next().value;
    if (oldest === undefined) break;
    localeCache.delete(oldest);
  }
}

/** Test and host lifecycle seam; observed current locale is never cached. */
export function clearAndroidAppLocaleCache(): void {
  localeCache.clear();
}

function validPackageName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

/** Package Manager also returns named system APKs, such as SecSettings.apk. */
export function androidBaseApkPath(packagePaths: string): string | undefined {
  const paths = packagePaths
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:/") && line.endsWith(".apk"))
    .map((line) => line.slice("package:".length));
  return (
    paths.find((apk) => path.posix.basename(apk) === "base.apk") ??
    paths.find((apk) => !path.posix.basename(apk).startsWith("split_"))
  );
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

/** Extract locales from APK resource configuration qualifiers when the app
 * has no LocaleConfig XML. Only language-bearing qualifiers are accepted;
 * density/night/region-only configurations are ignored. */
export function parseAndroidResourceLocales(resources: string): string[] {
  const locales = new Set<string>();
  for (const match of resources.matchAll(
    /^\s+\((b\+[A-Za-z0-9+]+|[A-Za-z]{2,3}(?:-r[A-Za-z]{2,3})?)(?:-[^)]+)?\)\s+\(/gm,
  )) {
    const qualifier = match[1]!;
    let locale: string | undefined;
    if (/^b\+[A-Za-z]{2,3}(?:\+[A-Za-z0-9]{2,8})*$/i.test(qualifier)) {
      locale = qualifier.slice(2).split("+").join("-");
    } else if (/^(?!r[A-Z]{2,3}$)[A-Za-z]{2,3}(?:-r[A-Za-z]{2,3})?$/u.test(qualifier)) {
      locale = qualifier.replace(/-r([A-Za-z]{2,3})$/u, "-$1");
    }
    if (locale) locales.add(locale);
  }
  return [...locales].sort();
}

/** Read the locale list the installed Android app itself declares. No product
 * preset is involved; any package using Android's LocaleConfig can reuse it. */
export async function listAndroidAppLocales(
  serial: string,
  packageName: string,
  options: {
    command?: LocaleDiscoveryCommand;
    resolveTool?: LocaleDiscoveryToolResolver;
  } = {},
): Promise<{
  locales: string[];
  currentLocale?: string;
  source?: "android-locale-manager" | "android-device-locale";
}> {
  if (!serial.trim()) throw new Error("device serial is required");
  if (!validPackageName(packageName))
    throw new Error("app package name contains unsupported characters");
  const resolveTool = options.resolveTool ?? resolveAndroidSdkTool;
  const command: LocaleDiscoveryCommand =
    options.command ??
    ((file, args, commandOptions) =>
      execFileAsync(file, [...args], commandOptions) as Promise<{ stdout?: string }>);
  const aapt2 = await resolveTool("aapt2");
  const adb = await resolveTool("adb");
  const current = await command(adb, [
    "-s",
    serial,
    "shell",
    "cmd",
    "locale",
    "get-app-locales",
    packageName,
  ]).catch(() => ({ stdout: "" }));
  let currentLocale = parseAndroidLocaleOutput(String(current.stdout ?? ""));
  let source: "android-locale-manager" | "android-device-locale" | undefined = currentLocale
    ? "android-locale-manager"
    : undefined;
  if (!currentLocale) {
    const device = await command(adb, [
      "-s",
      serial,
      "shell",
      "cmd",
      "locale",
      "get-device-locale",
    ]).catch(() => ({ stdout: "" }));
    currentLocale = parseAndroidLocaleOutput(String(device.stdout ?? ""));
    if (currentLocale) source = "android-device-locale";
  }
  const workspace = await mkdtemp(path.join(tmpdir(), "relay-app-locales-"));
  const apk = path.join(workspace, "base.apk");
  try {
    const { stdout: packagePaths } = await command(
      adb,
      ["-s", serial, "shell", "pm", "path", packageName],
      { maxBuffer: MAX_APK_TOOL_OUTPUT },
    );
    const remoteApk = androidBaseApkPath(String(packagePaths));
    if (!remoteApk) throw new Error(`${packageName} is not installed on ${serial}`);
    const packageDump = await command(
      adb,
      ["-s", serial, "shell", "dumpsys", "package", packageName],
      {
        maxBuffer: MAX_APK_TOOL_OUTPUT,
      },
    ).catch(() => ({ stdout: "" }));
    const dump = String(packageDump.stdout ?? "");
    const versionCode = dump.match(/versionCode=([^\s]+)/u)?.[1];
    const versionName = dump.match(/versionName=([^\r\n]+)/u)?.[1]?.trim();
    const lastUpdateTime = dump.match(/lastUpdateTime=([^\r\n]+)/u)?.[1]?.trim();
    // A cache entry is safe only when package-manager metadata identifies the
    // installed build. A path alone can remain stable across APK updates.
    const cacheKey =
      versionCode && lastUpdateTime
        ? androidLocaleCacheKey({
            serial,
            packageName,
            baseApkPath: remoteApk,
            versionCode,
            ...(versionName ? { versionName } : {}),
            lastUpdateTime,
          })
        : undefined;
    const cached = cacheKey ? cachedLocales(cacheKey) : undefined;
    if (cached) return { locales: cached, ...(currentLocale ? { currentLocale, source } : {}) };
    await command(adb, ["-s", serial, "pull", remoteApk, apk], {
      maxBuffer: MAX_APK_TOOL_OUTPUT,
    });
    const runAapt = async (args: string[]) =>
      String(
        (
          await command(aapt2, args, {
            maxBuffer: MAX_APK_TOOL_OUTPUT,
          })
        ).stdout,
      );
    const manifest = await runAapt(["dump", "xmltree", "--file", "AndroidManifest.xml", apk]);
    const resourceId = manifest.match(/android:localeConfig[^\n]*=@(0x[0-9a-f]+)/i)?.[1];
    if (!resourceId) {
      const locales = parseAndroidResourceLocales(await runAapt(["dump", "resources", apk]));
      if (cacheKey) cacheLocales(cacheKey, locales);
      return {
        locales,
        ...(currentLocale ? { currentLocale, source } : {}),
      };
    }
    const resources = await runAapt(["dump", "resources", apk]);
    const escaped = resourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const resourceName = resources.match(
      new RegExp(`resource\\s+${escaped}\\s+xml\\/([A-Za-z0-9_.-]+)`, "i"),
    )?.[1];
    if (!resourceName) {
      if (cacheKey) cacheLocales(cacheKey, []);
      return {
        locales: [],
        ...(currentLocale ? { currentLocale, source } : {}),
      };
    }
    const localeXml = await runAapt([
      "dump",
      "xmltree",
      "--file",
      `res/xml/${resourceName}.xml`,
      apk,
    ]);
    const locales = parseAndroidLocaleConfig({ manifest, resources, localeXml });
    if (cacheKey) cacheLocales(cacheKey, locales);
    return {
      locales,
      ...(currentLocale ? { currentLocale, source } : {}),
    };
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
