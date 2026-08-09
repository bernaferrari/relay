import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  buildCorpusCoverage,
  createCorpusSession,
  formatCorpusExport,
  corpusControls,
  listCorpusSessions,
  recordCorpusScreen,
  resetCorpusCrawlsForTests,
  titleFromNodes,
} from "./corpus.js";
import {
  corpusControlStableKey,
  observeLocaleStableIdentity,
  observeScreenIdentity,
  slugCorpusPathSegment,
} from "./screen-identity.js";

const roots: string[] = [];

afterEach(async () => {
  resetCorpusCrawlsForTests();
  delete process.env.RELAY_WORKSPACE_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-corpus-"));
  roots.push(root);
  process.env.RELAY_WORKSPACE_ROOT = root;
  return root;
}

function settingsNodes(language: "en" | "pt"): SnapshotNode[] {
  if (language === "en") {
    return [
      {
        index: 0,
        type: "StaticText",
        role: "header",
        label: "Settings",
        identifier: "settings.title",
        visibleToUser: true,
        hittable: false,
      },
      {
        index: 1,
        type: "Button",
        role: "button",
        label: "App language",
        identifier: "settings.language",
        visibleToUser: true,
        hittable: true,
      },
      {
        index: 2,
        type: "Button",
        role: "button",
        label: 'LocalizedStringKey(key: "Appearance", hasFormatting: false, arguments: [])',
        identifier: "settings.appearance",
        visibleToUser: true,
        hittable: true,
      },
    ];
  }
  return [
    {
      index: 0,
      type: "StaticText",
      role: "header",
      label: "Configurações",
      identifier: "settings.title",
      visibleToUser: true,
      hittable: false,
    },
    {
      index: 1,
      type: "Button",
      role: "button",
      label: "Idioma do app",
      identifier: "settings.language",
      visibleToUser: true,
      hittable: true,
    },
    {
      index: 2,
      type: "Button",
      role: "button",
      label: 'LocalizedStringKey(key: "Appearance", hasFormatting: false, arguments: [])',
      identifier: "settings.appearance",
      visibleToUser: true,
      hittable: true,
    },
  ];
}

test("locale-stable identity collapses translated settings screens", () => {
  const en = observeLocaleStableIdentity(settingsNodes("en"));
  const pt = observeLocaleStableIdentity(settingsNodes("pt"));
  assert.equal(en.fingerprint, pt.fingerprint);

  const enFull = observeScreenIdentity(settingsNodes("en"));
  const ptFull = observeScreenIdentity(settingsNodes("pt"));
  assert.notEqual(enFull.fingerprint, ptFull.fingerprint);
});

test("corpus control keys prefer identifiers and LocalizedStringKey", () => {
  assert.equal(
    corpusControlStableKey({ identifier: "settings.language", label: "Idioma do app" }),
    "id:settings.language",
  );
  assert.equal(
    corpusControlStableKey({
      label: 'LocalizedStringKey(key: "Appearance", hasFormatting: false, arguments: [])',
    }),
    "key:appearance",
  );
  assert.equal(slugCorpusPathSegment("App language"), "app-language");
});

test("corpusControls prefer identifier targets and filter sensitive rows", () => {
  const controls = corpusControls([
    ...settingsNodes("en"),
    {
      index: 9,
      type: "Button",
      role: "button",
      label: "Delete account",
      identifier: "settings.delete",
      visibleToUser: true,
      hittable: true,
    },
  ]);
  // Language switcher is out-of-band (switchToLocale); crawl must not open it.
  assert.ok(!controls.some((control) => control.stableKey === "id:settings.language"));
  assert.ok(controls.some((control) => control.stableKey === "id:settings.appearance"));
  assert.ok(!controls.some((control) => /delete/i.test(control.label)));
});

test("corpusControls keep SwiftUI cells and drop sheet chrome", () => {
  const controls = corpusControls([
    {
      index: 0,
      type: "Button",
      role: "button",
      label: "Close",
      hittable: true,
      visibleToUser: true,
    },
    {
      index: 1,
      type: "Cell",
      role: "cell",
      label: "Appearance",
      // iOS SwiftUI list rows often report hittable:false with only a ref.
      hittable: false,
      visibleToUser: true,
      ref: "e17",
    },
    {
      index: 2,
      type: "Button",
      role: "button",
      label: "grok-close",
      hittable: true,
      visibleToUser: true,
    },
    {
      index: 3,
      type: "Button",
      role: "button",
      label: "Rate the App",
      hittable: true,
      visibleToUser: true,
    },
    {
      index: 4,
      type: "Cell",
      role: "cell",
      label: "App Language, English",
      hittable: false,
      visibleToUser: true,
      ref: "e21",
    },
    {
      index: 5,
      type: "Button",
      role: "button",
      label: "Vertical scroll bar, 1 page",
      hittable: true,
      visibleToUser: true,
    },
    {
      index: 6,
      type: "Switch",
      role: "switch",
      label: "Enable Kids Mode",
      hittable: true,
      visibleToUser: true,
      value: "0",
    },
  ]);
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Appearance"],
  );
  assert.equal(controls[0]?.target.ref, "e17");
});

test("titleFromNodes prefers page title over toolbar chrome", () => {
  const title = titleFromNodes(
    [
      {
        index: 0,
        type: "NavigationBar",
        role: "navigationbar",
        label: "grok-arrow-left",
        identifier: "Kids Mode",
        visibleToUser: true,
      },
      {
        index: 1,
        type: "Button",
        role: "button",
        label: "grok-arrow-left",
        identifier: "toolbar.back.button",
        visibleToUser: true,
        hittable: true,
      },
      {
        index: 2,
        type: "StaticText",
        role: "statictext",
        label: "Kids Mode",
        visibleToUser: true,
        rect: { x: 375, y: 76, width: 84, height: 20 },
      },
    ],
    ["Kids Mode"],
  );
  assert.equal(title, "Kids Mode");
});

test("recordCorpusScreen dedupes by locale-stable canonical key", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Grok settings",
    targetId: "ipad",
    scope: { locales: ["en", "pt-BR"], maxDepth: 2 },
  });
  const first = await recordCorpusScreen({
    sessionId: session.id,
    nodes: settingsNodes("en"),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
    makeCurrent: true,
  });
  assert.equal(first.isNew, true);
  const again = await recordCorpusScreen({
    sessionId: session.id,
    nodes: settingsNodes("en"),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
  });
  assert.equal(again.isNew, false);
  assert.equal(again.screen.id, first.screen.id);

  const pt = await recordCorpusScreen({
    sessionId: session.id,
    nodes: settingsNodes("pt"),
    locale: "pt-BR",
    depth: 0,
    path: [],
    pathKeys: [],
  });
  assert.equal(pt.isNew, true);
  assert.equal(pt.screen.canonicalKey, first.screen.canonicalKey);
  assert.notEqual(pt.screen.fingerprint, first.screen.fingerprint);

  const listed = await listCorpusSessions();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.screens.length, 2);

  const coverage = buildCorpusCoverage(listed[0]!);
  assert.equal(coverage.screens.length, 1);
  assert.deepEqual(coverage.screens[0]!.observedLocales.sort(), ["en", "pt-BR"]);
  assert.equal(coverage.complete, 1);

  const markdown = formatCorpusExport(listed[0]!, "markdown");
  assert.match(markdown, /Grok settings/);
  assert.match(markdown, /pt-BR/);
});

test("normalizeScope defaults to map-once-replay and orders map locale first", async () => {
  // exercise through createCorpusSession
  const root = await mkdtemp(join(tmpdir(), "relay-corpus-map-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const session = await createCorpusSession({
      name: "Map once",
      targetId: "ipad",
      scope: { locales: ["pt-BR", "en", "es"], mapLocale: "en", maxDepth: 2 },
    });
    assert.equal(session.scope.strategy, "map-once-replay");
    assert.equal(session.scope.mapLocale, "en");
    assert.deepEqual(session.scope.locales, ["en", "pt-BR", "es"]);
  } finally {
    process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
