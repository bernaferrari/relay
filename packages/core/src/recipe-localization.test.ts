import assert from "node:assert/strict";
import test from "node:test";
import { createAndroidResourceStringIndex } from "./android-resource-strings.js";
import { localizeExpectedObservation } from "./recipe-localization.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";

function localization(dump: string) {
  const index = createAndroidResourceStringIndex(dump, { targetLocale: "ja" });
  const lookup = (source: string) =>
    index.lookup(source).status === "missing"
      ? index.lookup(source.slice(0, 1).toLocaleUpperCase() + source.slice(1))
      : index.lookup(source);
  return {
    packageName: "com.example.app",
    locale: "ja",
    lookup,
    translate: (source: string) => {
      const result = lookup(source);
      return result.status === "matched" ? result.target : undefined;
    },
  };
}

const dump = [
  "resource 0x1 string/title",
  '  () "Settings"',
  '  (ja) "設定"',
  "resource 0x2 string/network",
  '  () "Network & internet"',
  '  (ja) "ネットワークとインターネット"',
].join("\n");

function screen(title: string, row: string) {
  return observeScreenIdentity([
    { role: "view", identifier: "com.example.app:id/root", bundleId: "com.example.app" },
    {
      role: "text",
      identifier: "com.example.app:id/title",
      label: title,
      bundleId: "com.example.app",
    },
    {
      role: "button",
      identifier: "com.example.app:id/row",
      label: row,
      bundleId: "com.example.app",
    },
  ]);
}

test("localized expected observation matches the Japanese live screen", () => {
  const expected = screen("Settings", "Network & internet");
  const translated = localizeExpectedObservation(expected, localization(dump));
  assert.ok(translated);
  assert.equal(
    compareScreenIdentity(screen("設定", "ネットワークとインターネット"), translated).decision,
    "match",
  );
  assert.equal(
    expected.nodes.some((node) => node.label === "settings"),
    true,
  );
});

test("localized proof rejects a different screen", () => {
  const translated = localizeExpectedObservation(
    screen("Settings", "Network & internet"),
    localization(dump),
  );
  assert.ok(translated);
  assert.notEqual(compareScreenIdentity(screen("設定", "通知"), translated).decision, "match");
});

test("ambiguous captions remain unmatched rather than guessing a translation", () => {
  const ambiguous = localization(
    [
      'resource 0x1 string/one\n  () "Settings"\n  (ja) "設定"',
      'resource 0x2 string/two\n  () "Settings"\n  (ja) "セッティング"',
    ].join("\n"),
  );
  const translated = localizeExpectedObservation(
    screen("Settings", "Network & internet"),
    ambiguous,
  );
  assert.ok(translated);
  assert.ok(translated.nodes.some((node) => node.label === "settings"));
  assert.notEqual(
    compareScreenIdentity(screen("設定", "ネットワークとインターネット"), translated).decision,
    "match",
  );
});
