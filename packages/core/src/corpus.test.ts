import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  analyzeCorpus,
  buildCorpusCoverage,
  createCorpusSession,
  exportCorpusPack,
  formatCorpusExport,
  corpusControls,
  listCorpusSessions,
  readCorpusSession,
  recordCorpusScreen,
  resetCorpusCrawlsForTests,
  setCorpusStatus,
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

test("corpusControls use locale-independent structure when Compose omits identifiers", () => {
  const rows = (label: string): SnapshotNode[] => [
    {
      index: 0,
      type: "android.widget.ScrollView",
      parentIndex: undefined,
      visibleToUser: true,
    },
    {
      index: 1,
      type: "android.view.View",
      parentIndex: 0,
      label,
      hittable: true,
      visibleToUser: true,
      ref: "e1",
    },
  ];
  const english = corpusControls(rows("Usage"))[0];
  const italian = corpusControls(rows("Utilizzo"))[0];
  assert.ok(english?.stableKey.startsWith("structure:"));
  assert.equal(english?.stableKey, italian?.stableKey);
  assert.equal(english?.label, "Usage");
  assert.equal(italian?.label, "Utilizzo");
});

test("corpusControls ignore Android system UI and collapse row subtitles into one action", () => {
  const controls = corpusControls([
    {
      index: 0,
      type: "android.widget.FrameLayout",
      identifier: "com.android.systemui:id/navigation_bar_frame",
      bundleId: "com.android.systemui",
      visibleToUser: true,
    },
    {
      index: 1,
      type: "android.widget.ScrollView",
      visibleToUser: true,
    },
    {
      index: 2,
      parentIndex: 1,
      type: "android.view.View",
      visibleToUser: true,
    },
    {
      index: 3,
      parentIndex: 2,
      type: "android.view.View",
      hittable: true,
      visibleToUser: true,
      ref: "row-appearance",
    },
    {
      index: 4,
      parentIndex: 3,
      type: "android.widget.TextView",
      label: "Appearance",
      visibleToUser: true,
      ref: "appearance-label",
    },
    {
      index: 5,
      parentIndex: 3,
      type: "android.widget.TextView",
      label: "Dark",
      visibleToUser: true,
      ref: "appearance-value",
    },
    {
      index: 6,
      type: "android.view.View",
      identifier: "settings_button",
      hittable: true,
      visibleToUser: true,
      ref: "settings",
    },
  ]);

  assert.deepEqual(
    controls.map((control) => control.label),
    ["Appearance", "settings_button"],
  );
  assert.equal(controls[0]?.target.ref, "row-appearance");
  assert.equal(controls[1]?.target.identifier, "settings_button");
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

test("analyzeCorpus turns a locale crawl into an explainable review queue", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Localization review",
    targetId: "android",
    scope: { locales: ["en", "pt-BR", "it"], mapLocale: "en", maxDepth: 2 },
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: settingsNodes("en"),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: settingsNodes("pt"),
    locale: "pt-BR",
    depth: 0,
    path: [],
    pathKeys: [],
  });
  const current = (await listCorpusSessions())[0]!;
  const report = analyzeCorpus(current);

  assert.equal(report.baselineLocale, "en");
  assert.equal(report.critical, 1);
  assert.ok(
    report.findings.some((finding) => finding.code === "SCREEN_MISSING" && finding.locale === "it"),
  );
  assert.ok(
    report.findings.some(
      (finding) =>
        finding.code === "POSSIBLE_UNTRANSLATED_TEXT" &&
        finding.stableKey === "id:settings.appearance",
    ),
  );
  assert.ok(report.findings.every((finding) => finding.confidence !== undefined));
});

test("analyzeCorpus detects when a requested locale was probably not applied", async () => {
  const root = await workspace();
  const screenshot = join(root, "unchanged.png");
  await writeFile(screenshot, Buffer.from("same deterministic screenshot"));
  const session = await createCorpusSession({
    name: "Locale switch check",
    targetId: "android",
    scope: { locales: ["en", "it"], mapLocale: "en", maxDepth: 1 },
  });
  for (const locale of session.scope.locales) {
    await recordCorpusScreen({
      sessionId: session.id,
      nodes: settingsNodes("en"),
      locale,
      depth: 0,
      path: [],
      pathKeys: [],
      screenshotPath: screenshot,
    });
  }
  const saved = (await listCorpusSessions())[0]!;
  assert.ok(saved.screens.every((screen) => screen.snapshotDigest?.length === 64));
  const report = analyzeCorpus(saved);
  const finding = report.findings.find(
    (item) => item.code === "POSSIBLE_LOCALE_NOT_APPLIED" && item.locale === "it",
  );
  assert.equal(finding?.confidence, "high");
  assert.match(finding?.detail ?? "", /exact same screenshot/iu);
});

test("corpus accepts every dynamically discovered Grok locale", async () => {
  await workspace();
  const locales = Array.from({ length: 45 }, (_, index) => `x-relay-${index + 1}`);
  const session = await createCorpusSession({
    name: "All discovered locales",
    targetId: "android",
    scope: { locales, mapLocale: locales[0], maxDepth: 1 },
  });
  assert.deepEqual(session.scope.locales, locales);
});

test("an interrupted or stopped corpus is presented as resumable", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Resumable crawl",
    targetId: "android",
    scope: { locales: ["en", "it"], mapLocale: "en", maxDepth: 1 },
  });

  await setCorpusStatus(session.id, "running");
  const interrupted = (await listCorpusSessions())[0]!;
  assert.equal(interrupted.status, "paused");
  assert.match(interrupted.progress.message ?? "", /ready to resume/iu);
  assert.equal((await readCorpusSession(session.id))?.status, "running");

  await setCorpusStatus(session.id, "stopped");
  const resumed = await setCorpusStatus(session.id, "running");
  assert.equal(resumed.status, "running");
});

test("corpus pack freezes execution provenance and verifies every screenshot", async () => {
  const root = await workspace();
  const screenshot = join(root, "screen.png");
  await writeFile(screenshot, Buffer.from("frozen evidence bytes"));
  const session = await createCorpusSession({
    name: "Auditable pack",
    targetId: "android-physical",
    projectId: "mobile",
    organizationId: "relay",
    scope: {
      locales: ["en", "it"],
      mapLocale: "en",
      strategy: "map-once-replay",
      app: "ai.x.GrokApp",
      maxDepth: 1,
    },
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: settingsNodes("en"),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
    screenshotPath: screenshot,
    accessibility: {
      inspectable: true,
      nodes: settingsNodes("en"),
      screenIdentity: { fingerprint: "settings" },
    },
  });

  const exported = await exportCorpusPack(session.id);
  const onDisk = JSON.parse(
    await readFile(join(exported.rootDir, "manifest.json"), "utf8"),
  ) as typeof exported.manifest;

  assert.equal(onDisk.schemaVersion, 2);
  assert.equal(onDisk.execution.projectId, "mobile");
  assert.equal(onDisk.execution.organizationId, "relay");
  assert.equal(onDisk.execution.targetId, "android-physical");
  assert.equal(onDisk.execution.strategy, "map-once-replay");
  assert.equal(onDisk.execution.mapLocale, "en");
  assert.equal(onDisk.execution.app, "ai.x.GrokApp");
  assert.match(onDisk.screens[0]?.sha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(onDisk.screens[0]?.accessibilitySha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(onDisk.screens[0]?.accessibilityFile ?? "", /\.accessibility\.json$/u);
  const accessibility = JSON.parse(
    await readFile(join(exported.rootDir, onDisk.screens[0]!.accessibilityFile!), "utf8"),
  ) as { inspectable: boolean; nodes: unknown[] };
  assert.equal(accessibility.inspectable, true);
  assert.equal(accessibility.nodes.length, settingsNodes("en").length);
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
      scope: {
        locales: ["pt-BR", "en", "es"],
        mapLocale: "en",
        maxDepth: 2,
        entryPath: [{ kind: "tap", target: { point: { x: 78, y: 190 } } }],
      },
    });
    assert.equal(session.scope.strategy, "map-once-replay");
    assert.equal(session.scope.mapLocale, "en");
    assert.deepEqual(session.scope.locales, ["en", "pt-BR", "es"]);
    assert.deepEqual(session.scope.entryPath, [
      { kind: "tap", target: { point: { x: 78, y: 190 } } },
    ]);
  } finally {
    process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
