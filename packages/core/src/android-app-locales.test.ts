import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidLocaleConfig } from "./android-app-locales.js";

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

test("an app without LocaleConfig remains a manual modifier", () => {
  assert.deepEqual(parseAndroidLocaleConfig({ manifest: "", resources: "", localeXml: "" }), []);
});
