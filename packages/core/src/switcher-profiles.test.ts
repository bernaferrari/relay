import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  extractSwitcherOptionsFromNodes,
  getSwitcherProfile,
  corpusScopeFromSwitcherProfile,
  inferOptionId,
  listSwitcherProfiles,
  mergeSwitcherOptions,
  saveSwitcherProfile,
} from "./switcher-profiles.js";

const roots: string[] = [];

afterEach(async () => {
  delete process.env.RELAY_WORKSPACE_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-switcher-"));
  roots.push(root);
  process.env.RELAY_WORKSPACE_ROOT = root;
  return root;
}

test("inferOptionId covers language and non-language options", () => {
  assert.equal(inferOptionId("English"), "en");
  assert.equal(inferOptionId("Português (Brasil)", "Portuguese (Brazil)"), "pt-BR");
  assert.equal(inferOptionId("Staging"), "staging");
  assert.equal(inferOptionId("Dark mode", "Dark"), "dark");
  assert.equal(inferOptionId("Production"), "production");
});

test("extractSwitcherOptionsFromNodes is kind-agnostic", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Cell",
      label: "Staging",
      hittable: true,
      visibleToUser: true,
      enabled: true,
      rect: { x: 0, y: 80, width: 400, height: 44 },
    },
    {
      index: 1,
      type: "Cell",
      label: "Production",
      hittable: true,
      visibleToUser: true,
      enabled: true,
      rect: { x: 0, y: 130, width: 400, height: 44 },
    },
    {
      index: 2,
      type: "StaticText",
      label: "Environment",
      visibleToUser: true,
      rect: { x: 0, y: 0, width: 120, height: 20 },
    },
  ];
  const options = extractSwitcherOptionsFromNodes(nodes);
  const ids = options.map((option) => option.id).sort();
  assert.deepEqual(ids, ["production", "staging"]);
  assert.ok(!options.some((option) => option.label === "Environment"));
});

test("grok language seed is a language-kind switcher", async () => {
  await workspace();
  const profile = await getSwitcherProfile("grok-ios");
  assert.ok(profile);
  assert.equal(profile!.kind, "language");
  assert.equal(profile!.id, "grok-ios-language");
  assert.ok(profile!.options.some((option) => option.id === "pt-BR"));
});

test("corpusScopeFromSwitcherProfile expands option tags", async () => {
  await workspace();
  const scope = await corpusScopeFromSwitcherProfile("grok-ios-language", ["en", "it"]);
  assert.equal(scope.strategy, "map-once-replay");
  assert.equal(scope.mapLocale, "en");
  assert.deepEqual(scope.languageOptions?.it, [{ kind: "tap", target: { label: "Italiano" } }]);
});

test("saveSwitcherProfile persists account-kind profiles", async () => {
  await workspace();
  await saveSwitcherProfile({
    id: "demo-accounts",
    name: "Demo · accounts",
    kind: "account",
    app: "com.example.app",
    entryPath: [{ kind: "tap", target: { label: "Profile" } }],
    pickerPath: [{ kind: "tap", target: { label: "Switch account" } }],
    options: [
      { id: "qa", label: "QA Tester" },
      { id: "admin", label: "Admin" },
    ],
    defaultOptionId: "qa",
    scanned: false,
  });
  const listed = await listSwitcherProfiles({ kind: "account" });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.options.length, 2);
  const all = await listSwitcherProfiles();
  assert.ok(all.some((profile) => profile.kind === "language"));
  assert.ok(all.some((profile) => profile.kind === "account"));
});

test("extractSwitcherOptionsFromNodes prefers right-pane language cells", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      depth: 0,
      type: "Application",
      label: "Settings",
      rect: { x: 0, y: 0, width: 1112, height: 834 },
    },
    {
      index: 1,
      depth: 1,
      type: "Cell",
      label: "Airplane Mode",
      rect: { x: 20, y: 100, width: 400, height: 44 },
      parentIndex: 0,
      hittable: true,
    },
    {
      index: 2,
      depth: 1,
      type: "Cell",
      label: "English, Default",
      rect: { x: 600, y: 120, width: 480, height: 52 },
      parentIndex: 0,
      hittable: true,
    },
    {
      index: 3,
      depth: 1,
      type: "Cell",
      label: "Português (Brasil), Portuguese (Brazil)",
      rect: { x: 600, y: 180, width: 480, height: 52 },
      parentIndex: 0,
      hittable: true,
    },
    {
      index: 4,
      depth: 1,
      type: "Cell",
      label: "Italiano, Italian",
      rect: { x: 600, y: 240, width: 480, height: 52 },
      parentIndex: 0,
      hittable: true,
    },
  ];
  const options = extractSwitcherOptionsFromNodes(nodes);
  assert.deepEqual(options.map((option) => option.id).sort(), ["en", "it", "pt-BR"]);
  assert.ok(options.every((option) => !/airplane/i.test(option.label)));
});

test("mergeSwitcherOptions unions scanned into seed without wipe", () => {
  const merged = mergeSwitcherOptions(
    [
      { id: "en", label: "English" },
      { id: "pt-BR", label: "Português (Brasil)" },
      { id: "it", label: "Italiano" },
    ],
    [{ id: "ja", label: "日本語", identifier: "lang.ja" }],
  );
  assert.deepEqual(merged.map((option) => option.id).sort(), ["en", "it", "ja", "pt-BR"]);
  assert.equal(merged.find((option) => option.id === "ja")?.identifier, "lang.ja");
});
