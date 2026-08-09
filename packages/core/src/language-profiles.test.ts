import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  extractLanguageRowsFromNodes,
  getLanguageProfile,
  corpusScopeFromLanguageProfile,
  inferLanguageTag,
  listLanguageProfiles,
  localeRunScopeFromLanguageProfile,
  resolveLanguageOptions,
  saveLanguageProfile,
  switchLanguageModuleYaml,
} from "./language-profiles.js";

const roots: string[] = [];

afterEach(async () => {
  delete process.env.RELAY_WORKSPACE_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-lang-prof-"));
  roots.push(root);
  process.env.RELAY_WORKSPACE_ROOT = root;
  return root;
}

test("inferLanguageTag maps common picker labels", () => {
  assert.equal(inferLanguageTag("English"), "en");
  assert.equal(inferLanguageTag("Português (Brasil)", "Portuguese (Brazil)"), "pt-BR");
  assert.equal(inferLanguageTag("Italiano", "Italian"), "it");
  assert.equal(inferLanguageTag("日本語", "Japanese"), "ja");
  assert.equal(inferLanguageTag("简体中文", "Chinese, Simplified"), "zh-Hans");
  assert.equal(inferLanguageTag("Español", "Spanish"), "es");
  assert.equal(inferLanguageTag("Deutsch", "German"), "de");
  assert.equal(inferLanguageTag("Français", "French"), "fr");
});

test("extractLanguageRowsFromNodes builds rows from cells and subtitles", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Cell",
      label: "Português (Brasil)",
      hittable: true,
      visibleToUser: true,
      enabled: true,
      rect: { x: 0, y: 100, width: 400, height: 50 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: "StaticText",
      label: "Português (Brasil)",
      visibleToUser: true,
      rect: { x: 10, y: 105, width: 200, height: 20 },
    },
    {
      index: 2,
      parentIndex: 0,
      type: "StaticText",
      label: "Portuguese (Brazil)",
      visibleToUser: true,
      rect: { x: 10, y: 125, width: 200, height: 14 },
    },
    {
      index: 3,
      type: "Cell",
      label: "English",
      hittable: true,
      visibleToUser: true,
      enabled: true,
      rect: { x: 0, y: 40, width: 400, height: 50 },
    },
    {
      index: 4,
      type: "Button",
      label: "Reorder English",
      visibleToUser: true,
      rect: { x: 360, y: 40, width: 30, height: 50 },
    },
    {
      index: 5,
      type: "StaticText",
      label: "App Language",
      visibleToUser: true,
      rect: { x: 0, y: 0, width: 100, height: 20 },
    },
  ];
  const rows = extractLanguageRowsFromNodes(nodes);
  const tags = rows.map((row) => row.tag).sort();
  assert.deepEqual(tags, ["en", "pt-BR"]);
  assert.equal(rows.find((row) => row.tag === "pt-BR")?.label, "Português (Brasil)");
  assert.ok(!rows.some((row) => row.label === "App Language"));
  assert.ok(!rows.some((row) => /^Reorder/i.test(row.label)));
});

test("grok-ios seed lists captured languages", async () => {
  await workspace();
  const profile = await getLanguageProfile("grok-ios");
  assert.ok(profile);
  assert.equal(profile!.app, "ai.x.GrokApp");
  assert.deepEqual(
    profile!.languages.map((row) => row.tag),
    ["en", "pt-BR", "it"],
  );
});

test("resolveLanguageOptions maps tags to real picker labels", async () => {
  await workspace();
  const profile = (await getLanguageProfile("grok-ios"))!;
  const options = resolveLanguageOptions(profile, ["en", "pt-BR", "it", "ja"]);
  assert.equal(options.en?.label, "English");
  assert.equal(options["pt-BR"]?.label, "Português (Brasil)");
  assert.equal(options.it?.label, "Italiano");
  assert.equal(options.ja?.label, "ja");
});

test("corpusScopeFromLanguageProfile builds map-once scope", async () => {
  await workspace();
  const scope = await corpusScopeFromLanguageProfile("grok-ios", ["pt-BR", "en"]);
  assert.equal(scope.strategy, "map-once-replay");
  assert.equal(scope.mapLocale, "en");
  assert.equal(scope.app, "ai.x.GrokApp");
  assert.deepEqual(scope.languageOptions?.["pt-BR"], [
    { kind: "tap", target: { label: "Português (Brasil)" } },
  ]);
});

test("localeRunScopeFromLanguageProfile restores English", async () => {
  await workspace();
  const scope = await localeRunScopeFromLanguageProfile("grok-ios", ["it", "en"]);
  assert.equal(scope.restoreLocale, "en");
  assert.equal(scope.languageOptions?.it?.label, "Italiano");
});

test("saveLanguageProfile overrides seed after scan-like save", async () => {
  await workspace();
  const seed = (await getLanguageProfile("grok-ios"))!;
  const saved = await saveLanguageProfile({
    ...seed,
    languages: [
      ...seed.languages,
      { tag: "ja", label: "日本語", aliases: ["Japanese"] },
      { tag: "de", label: "Deutsch", aliases: ["German"] },
    ],
    scanned: true,
    notes: "live scan test",
  });
  assert.equal(saved.languages.length, 5);
  const listed = await listLanguageProfiles();
  const grok = listed.find((profile) => profile.id === "grok-ios")!;
  assert.equal(grok.languages.length, 5);
  assert.equal(grok.scanned, true);
  assert.ok(grok.languages.some((row) => row.tag === "ja"));
});

test("switchLanguageModuleYaml emits reusable module", async () => {
  await workspace();
  const profile = (await getLanguageProfile("grok-ios"))!;
  const yaml = switchLanguageModuleYaml(profile);
  assert.match(yaml, /id: switch-language-grok-ios/);
  assert.match(yaml, /locale_label/);
  assert.match(yaml, /App Language/);
});
