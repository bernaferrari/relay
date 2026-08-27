import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidLocaleConfig, setAndroidAppLocaleOnDevice } from "./android-app-locales.js";

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
