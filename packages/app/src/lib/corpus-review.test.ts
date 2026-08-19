import assert from "node:assert/strict";
import test from "node:test";
import type {
  CorpusAnalysisReport,
  CorpusFinding,
  CorpusScreen,
  CorpusSession,
  KnownLocaleFinding,
} from "@relay/protocol";
import {
  corpusReview,
  corpusScreenUrl,
  corpusStateLabel,
  localeGridColumns,
  sortCorpusSessions,
} from "./corpus-review";

function screen(input: {
  id: string;
  locale: string;
  canonicalKey?: string;
  /** A crawl that could not read the tree records no controls. */
  blind?: boolean;
}): CorpusScreen {
  const controls = input.blind
    ? []
    : [{ id: "c1", label: "Appearance", stableKey: "structure:row[0]", target: {} }];
  return {
    id: input.id,
    canonicalKey: input.canonicalKey ?? "settings",
    fingerprint: `fp-${input.id}`,
    locale: input.locale,
    depth: 1,
    path: ["Settings"],
    pathKeys: ["settings"],
    title: "Settings",
    capturedAt: 1,
    controls,
  };
}

function session(input: Partial<CorpusSession> = {}): CorpusSession {
  return {
    id: "sweep-1",
    name: "Grok · languages",
    targetId: "ipad",
    scope: {
      maxDepth: 2,
      maxScreens: 40,
      maxTransitions: 80,
      maxDurationMs: 600_000,
      locales: ["en", "pt-BR", "de"],
    },
    status: "complete",
    createdAt: 1,
    updatedAt: 2,
    progress: {
      phase: "complete",
      screensCaptured: 2,
      transitionsCaptured: 2,
      completedLocales: ["en", "pt-BR"],
      updatedAt: 2,
    },
    screens: [screen({ id: "s-en", locale: "en" }), screen({ id: "s-pt", locale: "pt-BR" })],
    transitions: [],
    ...input,
  };
}

function analysis(findings: CorpusFinding[]): CorpusAnalysisReport {
  return {
    schemaVersion: 1,
    sessionId: "sweep-1",
    generatedAt: 3,
    baselineLocale: "en",
    findings,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    affectedScreens: 1,
  };
}

function finding(input: Partial<CorpusFinding> & { locale: string }): CorpusFinding {
  return {
    id: `f-${input.locale}`,
    code: "POSSIBLE_TEXT_CLIPPED",
    severity: "warning",
    confidence: "medium",
    canonicalKey: "settings",
    screenLabel: "Settings",
    baselineLocale: "en",
    detail: "Translated label is wider than its control",
    ...input,
  };
}

function known(input: Partial<KnownLocaleFinding> = {}): KnownLocaleFinding {
  return {
    id: "f-pt-BR",
    code: "POSSIBLE_TEXT_CLIPPED",
    canonicalKey: "settings",
    screenLabel: "Settings",
    locale: "pt-BR",
    detail: "Reviewed",
    markedAt: 1,
    ...input,
  };
}

test("a screenshot nobody has analysed is not a pass", () => {
  const review = corpusReview({ session: session() });
  const cells = review.screens[0]!.cells;
  assert.equal(cells.find((cell) => cell.locale === "en")?.verdict, "unanalyzed");
  assert.equal(review.analyzed, false);
});

test("a screenshot captured without a tree is not a pass either", () => {
  // The sweep finished and the analysis ran, but this language's screenshot
  // carries no control labels, so nothing but its presence was ever compared.
  const review = corpusReview({
    session: session({
      screens: [
        screen({ id: "s-en", locale: "en" }),
        screen({ id: "s-pt", locale: "pt-BR", blind: true }),
      ],
    }),
    analysis: analysis([]),
  });
  const cells = review.screens[0]!.cells;
  assert.equal(cells.find((cell) => cell.locale === "en")?.verdict, "pass");
  assert.equal(cells.find((cell) => cell.locale === "pt-BR")?.verdict, "unanalyzed");
  assert.deepEqual(review.coverage, { captured: 2, inspected: 1 });
});

test("a baseline captured without a tree leaves its whole row unchecked", () => {
  const review = corpusReview({
    session: session({
      screens: [
        screen({ id: "s-en", locale: "en", blind: true }),
        screen({ id: "s-pt", locale: "pt-BR" }),
      ],
    }),
    analysis: analysis([]),
  });
  assert.deepEqual(
    review.screens[0]!.cells.map((cell) => cell.verdict),
    ["unanalyzed", "unanalyzed", "missing"],
  );
});

test("an analysed screen with nothing to report passes, and its findings win otherwise", () => {
  const review = corpusReview({
    session: session(),
    analysis: analysis([finding({ locale: "pt-BR" })]),
  });
  const cells = review.screens[0]!.cells;
  assert.equal(cells.find((cell) => cell.locale === "en")?.verdict, "pass");
  assert.equal(cells.find((cell) => cell.locale === "pt-BR")?.verdict, "clipped");
  assert.equal(review.defects, 1);
});

test("a finding somebody accepted stops counting as a defect but stays readable", () => {
  const review = corpusReview({
    session: session(),
    analysis: analysis([finding({ locale: "pt-BR" })]),
    known: [known()],
  });
  const cell = review.screens[0]!.cells.find((item) => item.locale === "pt-BR")!;
  assert.equal(cell.verdict, "known");
  assert.deepEqual(cell.findings, []);
  assert.deepEqual(
    cell.known.map((item) => item.id),
    ["f-pt-BR"],
  );
  assert.equal(review.defects, 0);
  assert.equal(review.known, 1);
});

test("an accepted finding does not hide a new one on the same cell", () => {
  const review = corpusReview({
    session: session(),
    analysis: analysis([
      finding({ locale: "pt-BR" }),
      finding({ locale: "pt-BR", id: "f-new", code: "POSSIBLE_LOCALE_NOT_APPLIED" }),
    ]),
    known: [known()],
  });
  const cell = review.screens[0]!.cells.find((item) => item.locale === "pt-BR")!;
  assert.equal(cell.verdict, "not-applied");
  assert.equal(review.defects, 1);
  assert.equal(review.known, 1);
});

test("a stable untranslated control can be accepted across locales", () => {
  const translated = finding({
    id: "f-de-untranslated",
    locale: "de",
    code: "POSSIBLE_UNTRANSLATED_TEXT",
    stableKey: "structure:row[0]",
  });
  const review = corpusReview({
    session: session({
      screens: [...session().screens, screen({ id: "s-de", locale: "de" })],
    }),
    analysis: analysis([translated]),
    known: [
      known({
        id: "f-it-untranslated",
        locale: "it",
        code: "POSSIBLE_UNTRANSLATED_TEXT",
        stableKey: "structure:row[0]",
        scope: "control",
        note: "Product name intentionally stays English",
      }),
    ],
  });
  assert.equal(review.screens[0]!.cells.find((cell) => cell.locale === "de")?.verdict, "known");
});

test("a geometry finding never inherits a control-wide acceptance", () => {
  const review = corpusReview({
    session: session({
      screens: [...session().screens, screen({ id: "s-de", locale: "de" })],
    }),
    analysis: analysis([
      finding({ id: "f-de-clipped", locale: "de", stableKey: "structure:row[0]" }),
    ]),
    known: [known({ scope: "control", stableKey: "structure:row[0]" })],
  });
  assert.equal(review.screens[0]!.cells.find((cell) => cell.locale === "de")?.verdict, "clipped");
});

test("a language the sweep never reached is missing once the sweep has stopped", () => {
  const review = corpusReview({
    session: session(),
    analysis: analysis([
      finding({ locale: "de", code: "SCREEN_MISSING", severity: "critical", confidence: "high" }),
    ]),
  });
  assert.equal(review.screens[0]!.cells.find((cell) => cell.locale === "de")?.verdict, "missing");
});

test("a language still on device is pending, not a missing-screen defect", () => {
  const review = corpusReview({
    session: session({
      status: "running",
      progress: { ...session().progress, phase: "replaying" },
    }),
    analysis: analysis([
      finding({ locale: "de", code: "SCREEN_MISSING", severity: "critical", confidence: "high" }),
    ]),
  });
  const cell = review.screens[0]!.cells.find((item) => item.locale === "de");
  assert.equal(cell?.verdict, "pending");
  assert.deepEqual(cell?.findings, []);
  assert.equal(review.defects, 0);
});

test("each language reports how much of the mapped tree it has covered", () => {
  const review = corpusReview({ session: session() });
  assert.deepEqual(review.localeProgress, [
    { locale: "en", captured: 1, total: 1, complete: true },
    { locale: "pt-BR", captured: 1, total: 1, complete: true },
    { locale: "de", captured: 0, total: 1, complete: false },
  ]);
});

test("cells carry the screenshot ids a compare needs, per language", () => {
  const review = corpusReview({ session: session() });
  const row = review.screens[0]!;
  assert.equal(row.baselineScreenId, "s-en");
  assert.equal(row.cells.find((cell) => cell.locale === "pt-BR")?.screenId, "s-pt");
  assert.equal(row.cells.find((cell) => cell.locale === "de")?.screenId, undefined);
});

test("verdict tallies arrive defect-first so the grid can be filtered down", () => {
  const review = corpusReview({
    session: session(),
    analysis: analysis([
      finding({ locale: "pt-BR", code: "POSSIBLE_LOCALE_NOT_APPLIED" }),
      finding({ locale: "de", code: "SCREEN_MISSING", severity: "critical", confidence: "high" }),
    ]),
  });
  assert.deepEqual(review.tallies, [
    { verdict: "not-applied", count: 1 },
    { verdict: "missing", count: 1 },
    { verdict: "pass", count: 1 },
  ]);
});

test("a sweep read before any coverage report still names its screens", () => {
  const review = corpusReview({ session: session() });
  assert.equal(review.screens[0]!.label, "Settings");
});

test("screenshot urls survive a server url with a trailing slash", () => {
  assert.equal(
    corpusScreenUrl("http://127.0.0.1:8787/", "sweep 1", "s-en"),
    "http://127.0.0.1:8787/corpus/sweep%201/screens/s-en",
  );
});

test("a finished sweep says so even when its last phase was never written", () => {
  assert.equal(corpusStateLabel({ status: "complete", phase: "idle" }), "Finished");
  assert.equal(corpusStateLabel({ status: "failed", phase: "replaying" }), "Failed");
  assert.equal(
    corpusStateLabel({ status: "running", phase: "switching-language" }),
    "Switching language",
  );
});

test("the live sweep sorts first, then the most recently touched", () => {
  const ordered = sortCorpusSessions([
    session({ id: "old", updatedAt: 1 }),
    session({ id: "live", status: "running", updatedAt: 0 }),
    session({ id: "recent", updatedAt: 9 }),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["live", "recent", "old"],
  );
});

test("sparse locale grids stay card-sized while dense reviews fill the pane", () => {
  assert.match(localeGridColumns(1), /320px/);
  assert.match(localeGridColumns(3), /280px/);
  assert.match(localeGridColumns(40), /1fr/);
});
