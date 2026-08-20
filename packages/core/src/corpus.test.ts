import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  analyzeCorpus,
  buildCorpusCoverage,
  corpusCrawlLoopsForTests,
  createCorpusReplaySession,
  createCorpusSession,
  exportCorpusPack,
  formatCorpusExport,
  corpusControls,
  crawlableCorpusControls,
  listCorpusSessions,
  readCorpusSession,
  recordCorpusScreen,
  resetCorpusCrawlsForTests,
  setCorpusCrawlRuntimeForTests,
  setCorpusStatus,
  titleFromNodes,
} from "./corpus.js";
import { IosMutationOutcomeUnknownError, type Device } from "./device.js";
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

function corpusUnknownMutation(operation: "press" | "scroll" = "press") {
  return new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation,
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: {
        required: true,
        action: "capture-current-screen-before-any-retry",
      },
      at: 1,
    },
    new Error("lost native acknowledgement"),
  );
}

const queuedControlNodes: SnapshotNode[] = [
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
    label: "First row",
    identifier: "settings.first",
    visibleToUser: true,
    hittable: true,
  },
  {
    index: 2,
    type: "Button",
    role: "button",
    label: "Second row",
    identifier: "settings.second",
    visibleToUser: true,
    hittable: true,
  },
];

async function captureQueuedControlRoot(input: {
  sessionId: string;
  locale: string;
  depth: number;
  path: string[];
  pathKeys: string[];
}) {
  return await recordCorpusScreen({
    sessionId: input.sessionId,
    nodes: queuedControlNodes,
    locale: input.locale,
    depth: input.depth,
    path: input.path,
    pathKeys: input.pathKeys,
    makeCurrent: true,
  });
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
  const crawlable = crawlableCorpusControls(controls);
  // Language switcher is out-of-band (switchToLocale); crawl must not open it.
  assert.ok(!crawlable.some((control) => control.stableKey === "id:settings.language"));
  assert.ok(crawlable.some((control) => control.stableKey === "id:settings.appearance"));
  assert.ok(!crawlable.some((control) => /delete/i.test(control.label)));
  // Both are still observed, so a locale sweep can compare their copy.
  assert.ok(controls.some((control) => control.stableKey === "id:settings.language"));
  assert.ok(controls.some((control) => control.stableKey === "id:settings.delete"));
});

test("chrome is filtered by identifier, so every locale is compared equally", () => {
  // Measured on the physical iPad: the same Grok Ask screen reported four
  // controls in English and ten in Italian, because the filter matched the
  // visible label against English words. Comparison starts from the baseline's
  // keys, so the six that only survived outside English were compared in no
  // language at all.
  const askScreen = (labels: {
    search: string;
    ask: string;
    build: string;
    sidebar: string;
    attach: string;
    speak: string;
    model: string;
  }): SnapshotNode[] =>
    (
      [
        ["sidebar.search.field", labels.search, "TextField"],
        ["navigation.tab.ask", labels.ask, "Button"],
        ["navigation.tab.build", labels.build, "Button"],
        ["sidebar.open.button", labels.sidebar, "Button"],
        ["ask.toolbar.add.button", labels.attach, "Button"],
        ["voice.speak.button", labels.speak, "Button"],
        ["toolbar.model.selector.button", labels.model, "Button"],
        // The app's own handle for an icon, spoken as the label.
        ["sidebar.settings.button", "grok-gear", "Button"],
      ] as const
    ).map(([identifier, label, type], index) => ({
      index,
      type,
      role: type.toLocaleLowerCase(),
      identifier,
      label,
      hittable: true,
      visibleToUser: true,
    })) as unknown as SnapshotNode[];

  const english = corpusControls(
    askScreen({
      search: "Search",
      ask: "Ask",
      build: "Build",
      sidebar: "Open sidebar",
      attach: "Attach",
      speak: "Speak",
      model: "Expert",
    }),
  );
  const italian = corpusControls(
    askScreen({
      search: "Cerca",
      ask: "Chiedi",
      build: "Compilazione",
      sidebar: "Apri la barra laterale",
      attach: "Allega",
      speak: "Parla",
      model: "Esperto",
    }),
  );

  assert.deepEqual(
    english.map((control) => control.stableKey),
    italian.map((control) => control.stableKey),
  );
  assert.deepEqual(
    crawlableCorpusControls(english).map((control) => control.stableKey),
    crawlableCorpusControls(italian).map((control) => control.stableKey),
  );
  // The tabs are destinations. They only looked like chrome because "Ask" and
  // "Build" are also titles this app must not name a screen after.
  assert.deepEqual(
    crawlableCorpusControls(english).map((control) => control.stableKey),
    ["id:navigation.tab.ask", "id:navigation.tab.build", "id:toolbar.model.selector.button"],
  );
  // Tapping a search field summons the keyboard, which is what made the sweep
  // unreadable in the first place. It is observed, never opened.
  const search = english.find((control) => control.stableKey === "id:sidebar.search.field");
  assert.equal(search?.skipCrawl, true);
  assert.equal(search?.label, "Search");
  // "grok-gear" reads the same in all forty languages because nobody wrote it
  // for a reader. Recording it would report one untranslated string per locale.
  assert.ok(!english.some((control) => control.label === "grok-gear"));
});

test("corpusControls keep SwiftUI cells and keep sheet chrome out of the crawl", () => {
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
    crawlableCorpusControls(controls).map((control) => control.label),
    ["Appearance"],
  );
  assert.equal(crawlableCorpusControls(controls)[0]?.target.ref, "e17");
  // Chrome with no identifier still falls back to the word list, and is still
  // recorded: "Close" is copy, and a sweep that drops it cannot compare it.
  assert.deepEqual(
    controls.filter((control) => control.skipCrawl).map((control) => control.label),
    ["Close", "Rate the App", "App Language, English"],
  );
  // A scroll bar, a switch's bare "0", and the app's own `grok-close` handle
  // are not copy anyone translated.
  assert.ok(!controls.some((control) => /scroll bar|Kids Mode|grok-/i.test(control.label)));
});

test("corpusControls expose toggles only for explicit recorded journeys", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Switch",
      role: "switch",
      label: "Enable Kids Mode",
      hittable: true,
      visibleToUser: true,
      value: "0",
      ref: "kids-toggle",
    },
  ];
  assert.deepEqual(corpusControls(nodes), []);
  assert.deepEqual(
    corpusControls(nodes, { includeToggles: true }).map((control) => control.label),
    ["Enable Kids Mode"],
  );
});

test("corpus scope preserves explicit dialog and state checkpoints", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Stateful settings",
    targetId: "android",
    scope: {
      locales: ["en", "it"],
      journeys: [
        {
          id: "profile-birth-year",
          name: "Profile",
          steps: [
            {
              kind: "tap",
              target: { stableKey: "structure:profile-row", label: "Profile" },
            },
            {
              kind: "tap",
              target: { stableKey: "structure:birth-year-row", label: "Birth Year" },
            },
            { kind: "capture", name: "Birth Year dialog", key: "birth-year-dialog" },
            { kind: "back" },
          ],
        },
      ],
    },
  });

  assert.deepEqual(session.scope.journeys, [
    {
      id: "profile-birth-year",
      name: "Profile",
      steps: [
        {
          kind: "tap",
          target: { stableKey: "structure:profile-row", label: "Profile" },
        },
        {
          kind: "tap",
          target: { stableKey: "structure:birth-year-row", label: "Birth Year" },
        },
        { kind: "capture", name: "Birth Year dialog", key: "birth-year-dialog" },
        { kind: "back" },
      ],
    },
  ]);
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

test("an unknown iOS queued crawl control is terminal before the next queued row or backtrack", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Unknown queued control",
    targetId: "ios-corpus-queued",
    scope: { locales: ["en"], maxDepth: 2 },
  });
  const physical: string[] = [];
  let backtracks = 0;
  setCorpusCrawlRuntimeForTests({
    captureCurrent: captureQueuedControlRoot,
    collectControlsWithScroll: async () => ({ nodes: queuedControlNodes, controls: [] }),
    interactCorpusControl: async ({ control }) => {
      physical.push(control.label);
      throw corpusUnknownMutation("press");
    },
    backtrack: async () => {
      backtracks += 1;
    },
  });

  await assert.rejects(
    corpusCrawlLoopsForTests.crawlLocale({
      session,
      locale: "en",
      serial: "ios-corpus-queued",
      device: {} as Device,
      recordPlan: [],
    }),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(physical, ["First row"]);
  assert.equal(backtracks, 0);
});

test("an unknown iOS full-surface collection stops before crawl taps or inverse scroll recovery", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Unknown surface collection",
    targetId: "ios-corpus-scroll",
    scope: { locales: ["en"], maxDepth: 2 },
  });
  const physical: string[] = [];
  setCorpusCrawlRuntimeForTests({
    captureCurrent: captureQueuedControlRoot,
    collectControlsWithScroll: async () => {
      physical.push("scroll-down");
      throw corpusUnknownMutation("scroll");
    },
    interactCorpusControl: async ({ control }) => {
      physical.push(`tap:${control.label}`);
      return control;
    },
    backtrack: async () => {
      physical.push("backtrack");
    },
  });

  await assert.rejects(
    corpusCrawlLoopsForTests.crawlLocale({
      session,
      locale: "en",
      serial: "ios-corpus-scroll",
      device: {} as Device,
      recordPlan: [],
    }),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(physical, ["scroll-down"]);
});

test("an unknown iOS map replay action is terminal before later plan actions", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Unknown replay action",
    targetId: "ios-corpus-replay",
    scope: { locales: ["en", "it"], mapLocale: "en", maxDepth: 2 },
  });
  const physical: string[] = [];
  setCorpusCrawlRuntimeForTests({
    captureCurrent: captureQueuedControlRoot,
    collectControlsWithScroll: async () => ({ nodes: queuedControlNodes, controls: [] }),
    interactCorpusControl: async ({ control }) => {
      physical.push(control.label);
      throw corpusUnknownMutation("press");
    },
    backtrack: async () => {
      physical.push("backtrack");
    },
  });

  await assert.rejects(
    corpusCrawlLoopsForTests.replayLocalePlan({
      session,
      locale: "it",
      serial: "ios-corpus-replay",
      device: {} as Device,
      plan: {
        mappedLocale: "en",
        mappedAt: 1,
        actions: [
          {
            kind: "open",
            stableKey: "id:settings.first",
            label: "First row",
            target: { identifier: "settings.first" },
            depth: 0,
            pathKeys: ["id:settings.first"],
            path: ["First row"],
            fromCanonicalKey: "settings",
          },
          {
            kind: "open",
            stableKey: "id:settings.second",
            label: "Second row",
            target: { identifier: "settings.second" },
            depth: 0,
            pathKeys: ["id:settings.second"],
            path: ["Second row"],
            fromCanonicalKey: "settings",
          },
        ],
      },
    }),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(physical, ["First row"]);
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

test("analyzeCorpus does not report a leaked identifier as untranslated copy", async () => {
  // A physical Grok sweep hands back `RightButtonBar` and
  // `imagine.animateYourPhotos.cell` in the label slot. They are identical in
  // every language because nobody wrote them for a reader, and reporting them
  // once per locale buries the real translation defects underneath.
  await workspace();
  const leaky = (translated: boolean): SnapshotNode[] => [
    {
      index: 0,
      type: "Button",
      role: "button",
      label: "RightButtonBar",
      identifier: "grok.toolbar.right",
      visibleToUser: true,
      hittable: true,
    },
    {
      index: 1,
      type: "Button",
      role: "button",
      label: "imagine.animateYourPhotos.cell",
      identifier: "grok.suggestion.animate",
      visibleToUser: true,
      hittable: true,
    },
    {
      index: 2,
      type: "Button",
      role: "button",
      label: translated ? "Ocultar teclado" : "Hide keyboard",
      identifier: "grok.keyboard.hide",
      visibleToUser: true,
      hittable: true,
    },
  ];
  const session = await createCorpusSession({
    name: "Leaked identifiers",
    targetId: "ios",
    scope: { locales: ["en", "pt-BR"], mapLocale: "en", maxDepth: 1 },
  });
  for (const [locale, translated] of [
    ["en", false],
    ["pt-BR", true],
  ] as const) {
    await recordCorpusScreen({
      sessionId: session.id,
      nodes: leaky(translated),
      locale,
      depth: 0,
      path: [],
      pathKeys: [],
    });
  }

  const report = analyzeCorpus((await listCorpusSessions())[0]!);

  assert.deepEqual(
    report.findings.filter((finding) => finding.code === "POSSIBLE_UNTRANSLATED_TEXT"),
    [],
  );
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

test("a terminal iOS repair freezes its reason and read-only evidence in the partial pack", async () => {
  const root = await workspace();
  const session = await createCorpusSession({
    name: "Terminal repair pack",
    targetId: "ios-terminal-pack",
    scope: { locales: ["en"], maxDepth: 1 },
  });
  const repairDir = join(root, ".relay", "corpus", session.id, "repair");
  await mkdir(repairDir, { recursive: true });
  await writeFile(join(repairDir, "ios-mutation-1.png"), Buffer.from("terminal pixels"));
  await writeFile(join(repairDir, "ios-mutation-1.accessibility.json"), '{"nodes":[]}');

  const terminalSession = (await readCorpusSession(session.id))!;
  terminalSession.status = "failed";
  terminalSession.error = "Repair required — iOS press acknowledgement unknown";
  terminalSession.terminal = {
    code: "ios-mutation-outcome-unknown",
    message: "The iOS press may already have reached the device.",
    recordedAt: 1,
    operation: "press",
    nativeAttempts: 1,
    nextAction: "capture-current-screen-before-any-retry",
    evidence: {
      corpusSessionId: session.id,
      screenshotPath: "repair/ios-mutation-1.png",
      accessibilityPath: "repair/ios-mutation-1.accessibility.json",
    },
  };
  await writeFile(
    join(root, ".relay", "corpus", `${session.id}.json`),
    `${JSON.stringify(terminalSession, null, 2)}\n`,
    "utf8",
  );

  const exported = await exportCorpusPack(session.id);
  const manifest = JSON.parse(
    await readFile(join(exported.rootDir, "manifest.json"), "utf8"),
  ) as typeof exported.manifest;

  assert.equal(manifest.execution.status, "failed");
  assert.equal(manifest.execution.terminal?.code, "ios-mutation-outcome-unknown");
  assert.equal(manifest.execution.terminal?.evidence.corpusSessionId, session.id);
  assert.equal(existsSync(join(exported.rootDir, "repair", "ios-mutation-1.png")), true);
  assert.equal(
    existsSync(join(exported.rootDir, "repair", "ios-mutation-1.accessibility.json")),
    true,
  );
  assert.match(
    await readFile(join(exported.rootDir, "README.md"), "utf8"),
    /Repair required[\s\S]*unknown outcome/iu,
  );
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

test("locale replay reuses English screenshots, accessibility, and the recorded map", async () => {
  const root = await workspace();
  const screenshot = join(root, "baseline.png");
  await writeFile(screenshot, Buffer.from("baseline evidence"));
  const source = await createCorpusSession({
    name: "English baseline",
    targetId: "android",
    scope: { locales: ["en"], mapLocale: "en", strategy: "map-once-replay", maxDepth: 1 },
  });
  const recorded = await recordCorpusScreen({
    sessionId: source.id,
    nodes: settingsNodes("en"),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
    screenshotPath: screenshot,
    accessibility: { inspectable: true, nodes: settingsNodes("en") },
  });
  const sourceWithPlan = (await readCorpusSession(source.id))!;
  sourceWithPlan.mapPlan = { mappedLocale: "en", mappedAt: Date.now(), actions: [] };
  sourceWithPlan.mapPlan.actions.push({
    kind: "open",
    depth: 0,
    label: "Settings",
    stableKey: "id:settings",
    target: { identifier: "settings" },
    path: [],
    pathKeys: [],
    fromCanonicalKey: recorded.screen.canonicalKey,
    toCanonicalKey: recorded.screen.canonicalKey,
  });
  await writeFile(
    join(root, ".relay", "corpus", `${source.id}.json`),
    `${JSON.stringify(sourceWithPlan, null, 2)}\n`,
    "utf8",
  );

  const replay = await createCorpusReplaySession({
    sourceSessionId: source.id,
    name: "Italian and Spanish",
    targetId: "android",
    locales: ["it", "es"],
  });

  assert.deepEqual(replay.scope.locales, ["en", "it", "es"]);
  assert.equal(replay.screens.length, 1);
  assert.equal(replay.progress.completedLocales?.[0], "en");
  assert.equal(replay.mapPlan?.actions.length, 1);
  assert.equal(
    existsSync(join(root, ".relay", "corpus", replay.id, "screens", `${recorded.screen.id}.png`)),
    true,
  );
  assert.equal(
    existsSync(
      join(
        root,
        ".relay",
        "corpus",
        replay.id,
        "screens",
        `${recorded.screen.id}.accessibility.json`,
      ),
    ),
    true,
  );
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

/** One settings row whose label and box are both under the caller's control. */
function rowNodes(label: string, width: number): SnapshotNode[] {
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
      label,
      identifier: "settings.notifications",
      visibleToUser: true,
      hittable: true,
      rect: { x: 0, y: 100, width, height: 44 },
    },
  ];
}

test("a translation that outgrows its unchanged box is reported as probably clipped", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Fit review",
    targetId: "android",
    scope: { locales: ["en", "de"], mapLocale: "en", maxDepth: 1 },
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: rowNodes("Notifications", 220),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: rowNodes("Benachrichtigungseinstellungen", 220),
    locale: "de",
    depth: 0,
    path: [],
    pathKeys: [],
  });

  const report = analyzeCorpus((await listCorpusSessions())[0]!);
  const finding = report.findings.find((item) => item.code === "POSSIBLE_TEXT_CLIPPED");
  assert.equal(finding?.locale, "de");
  assert.equal(finding?.confidence, "medium");
  assert.equal(finding?.severity, "warning");
  assert.equal(finding?.expected, "Notifications");
  assert.match(finding?.detail ?? "", /same 220×44 box/u);
});

test("an ellipsis in the translated label is reported with high confidence", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Fit review",
    targetId: "android",
    scope: { locales: ["en", "de"], mapLocale: "en", maxDepth: 1 },
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: rowNodes("Notifications", 220),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: rowNodes("Benachrichti\u2026", 220),
    locale: "de",
    depth: 0,
    path: [],
    pathKeys: [],
  });

  const report = analyzeCorpus((await listCorpusSessions())[0]!);
  const finding = report.findings.find((item) => item.code === "POSSIBLE_TEXT_CLIPPED");
  assert.equal(finding?.confidence, "high");
  assert.match(finding?.detail ?? "", /is cut off/u);
});

test("a translation that was given more room is not reported as clipped", async () => {
  await workspace();
  const session = await createCorpusSession({
    name: "Fit review",
    targetId: "android",
    scope: { locales: ["en", "de"], mapLocale: "en", maxDepth: 1 },
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: rowNodes("Notifications", 220),
    locale: "en",
    depth: 0,
    path: [],
    pathKeys: [],
  });
  await recordCorpusScreen({
    sessionId: session.id,
    nodes: rowNodes("Benachrichtigungseinstellungen", 420),
    locale: "de",
    depth: 0,
    path: [],
    pathKeys: [],
  });

  const report = analyzeCorpus((await listCorpusSessions())[0]!);
  assert.equal(
    report.findings.some((item) => item.code === "POSSIBLE_TEXT_CLIPPED"),
    false,
  );
});

test("controls carry the box they were observed in", () => {
  const controls = corpusControls(rowNodes("Notifications", 220));
  const row = controls.find((control) => control.stableKey.includes("settings.notifications"));
  assert.deepEqual(row?.rect, { x: 0, y: 100, width: 220, height: 44 });
});
