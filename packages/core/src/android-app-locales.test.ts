import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import {
  androidBaseApkPath,
  clearAndroidAppLocaleCache,
  listAndroidAppLocales,
  parseAndroidLocaleConfig,
  parseAndroidResourceLocales,
  setAndroidAppLocaleOnDevice,
} from "./android-app-locales.js";

test("discovers LocaleConfig through the callsite cache without caching current locale", async () => {
  clearAndroidAppLocaleCache();
  let currentLocale = "en-US";
  let build = { versionCode: "42", lastUpdateTime: "2026-09-09 01:00:00" };
  let apkLocales = ["en", "de"];
  const calls: string[][] = [];
  const command = async (file: string, args: readonly string[]) => {
    calls.push([file, ...args]);
    if (args.includes("get-app-locales"))
      return { stdout: `Locales for app for user 0 are [${currentLocale}]` };
    if (args.includes("get-device-locale")) return { stdout: "" };
    if (args.includes("pm") && args.includes("path"))
      return { stdout: "package:/data/app/example/base.apk\n" };
    if (args.includes("dumpsys"))
      return {
        stdout: `versionCode=${build.versionCode}\nversionName=1.0\nlastUpdateTime=${build.lastUpdateTime}\n`,
      };
    if (args.includes("pull")) {
      await writeFile(args.at(-1)!, "fake apk");
      return { stdout: "" };
    }
    if (args[0] === "dump" && args[1] === "xmltree" && args[3] === "AndroidManifest.xml")
      return { stdout: "A: android:localeConfig=@0x7f16000e" };
    if (args[0] === "dump" && args[1] === "resources")
      return { stdout: "resource 0x7f16000e xml/locales_config" };
    if (args[0] === "dump" && args[1] === "xmltree")
      return {
        stdout: apkLocales
          .map((locale) => `A: android:name="${locale}" (Raw: "${locale}")`)
          .join("\n"),
      };
    throw new Error(`unexpected fake command: ${args.join(" ")}`);
  };
  const options = { command, resolveTool: async (tool: "adb" | "aapt2") => tool };

  const first = await listAndroidAppLocales("pixel-1", "com.example", options);
  assert.deepEqual(first, {
    locales: ["en", "de"],
    currentLocale: "en-US",
    source: "android-locale-manager",
  });
  const extractionCalls = calls.length;
  currentLocale = "de-DE";
  const second = await listAndroidAppLocales("pixel-1", "com.example", options);
  assert.deepEqual(second, {
    locales: ["en", "de"],
    currentLocale: "de-DE",
    source: "android-locale-manager",
  });
  assert.equal(
    calls.length,
    extractionCalls + 3,
    "cache hit still reads locale, path, and build metadata",
  );

  build = { versionCode: "43", lastUpdateTime: "2026-09-09 02:00:00" };
  apkLocales = ["en", "fr"];
  const third = await listAndroidAppLocales("pixel-1", "com.example", options);
  assert.deepEqual(third.locales, ["en", "fr"]);
  assert.ok(calls.length > extractionCalls + 3, "changed APK identity must re-extract resources");
});

test("does not cache APK locales when package build identity is unavailable", async () => {
  clearAndroidAppLocaleCache();
  let pulls = 0;
  const command = async (file: string, args: readonly string[]) => {
    if (args.includes("get-app-locales")) return { stdout: "Locales for app for user 0 are [en]" };
    if (args.includes("pm") && args.includes("path"))
      return { stdout: "package:/data/app/example/base.apk" };
    if (args.includes("dumpsys")) throw new Error("dumpsys unavailable");
    if (args.includes("pull")) {
      pulls++;
      await writeFile(args.at(-1)!, "fake apk");
      return { stdout: "" };
    }
    if (args[0] === "dump" && args[1] === "xmltree" && args[3] === "AndroidManifest.xml")
      return { stdout: "" };
    if (args[0] === "dump" && args[1] === "resources")
      return { stdout: "      (en) (array) size=1" };
    throw new Error(`unexpected fake command: ${args.join(" ")}`);
  };
  const options = { command, resolveTool: async (tool: "adb" | "aapt2") => tool };
  await listAndroidAppLocales("pixel-1", "com.example", options);
  await listAndroidAppLocales("pixel-1", "com.example", options);
  assert.equal(pulls, 2);
});

test("finds named system APKs and prefers the base over locale splits", () => {
  assert.equal(
    androidBaseApkPath("package:/system/priv-app/SecSettings/SecSettings.apk\r\n"),
    "/system/priv-app/SecSettings/SecSettings.apk",
  );
  assert.equal(
    androidBaseApkPath(
      "package:/data/app/example/split_config.en.apk\npackage:/data/app/example/base.apk",
    ),
    "/data/app/example/base.apk",
  );
  assert.equal(androidBaseApkPath(""), undefined);
  assert.equal(androidBaseApkPath("Error: package not found"), undefined);
  assert.equal(androidBaseApkPath("package:/data/app/example/split_config.en.apk"), undefined);
});

test("reads the app-declared Android locales without product-specific seeds", () => {
  assert.deepEqual(
    parseAndroidLocaleConfig({
      manifest: "A: android:localeConfig=@0x7f16000e",
      resources: "resource 0x7f16000e xml/locales_config",
      localeXml: [
        'A: android:name="en" (Raw: "en")',
        'A: android:name="pt-BR" (Raw: "pt-BR")',
        'A: android:name="zh-CN" (Raw: "zh-CN")',
        'A: android:name="invalid_tag" (Raw: "invalid_tag")',
      ].join("\n"),
    }),
    ["en", "pt-BR", "zh-CN"],
  );
});

test("an app without LocaleConfig remains a manual Variable", () => {
  assert.deepEqual(parseAndroidLocaleConfig({ manifest: "", resources: "", localeXml: "" }), []);
});

test("extracts only language resource qualifiers as actual APK locales", () => {
  assert.deepEqual(
    parseAndroidResourceLocales(
      [
        "      (pt) (array) size=2",
        "      (en-rCA) (array) size=2",
        "      (b+zh+Hans) (array) size=2",
        "      (night) (array) size=2",
        "      (rUS) (array) size=2",
        '      () "CPU (CPU) DNS (DNS) USB (USB) You (You)"',
        "      (en-land) (array) size=2",
      ].join("\n"),
    ),
    ["en", "en-CA", "pt", "zh-Hans"],
  );
});

test("setAndroidAppLocaleOnDevice rejects before adb when inputs are unusable", async () => {
  await assert.rejects(() => setAndroidAppLocaleOnDevice("", "com.example", "he"), /serial/u);
  await assert.rejects(
    () => setAndroidAppLocaleOnDevice("pixel-1", "com example!", "he"),
    /unsupported characters/u,
  );
});

test("setAndroidAppLocaleOnDevice applies and reports the read-back locale", async () => {
  const sets: string[] = [];
  const observed = await setAndroidAppLocaleOnDevice("pixel-1", "com.example", "he", {
    command: async (args) => {
      const set = args.includes("set-app-locales");
      if (set) {
        sets.push(args[args.indexOf("--locales") + 1] ?? "");
        return { stdout: "" };
      }
      return {
        stdout: sets.at(-1) ? `Locales for app for user 0 are [${sets.at(-1)}]` : "[]",
      };
    },
  });
  assert.deepEqual(sets, ["he"]);
  assert.equal(observed, "he");
});
