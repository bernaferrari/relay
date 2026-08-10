import assert from "node:assert/strict";
import test from "node:test";
import type { CorpusScreen, CorpusSession } from "@relay/protocol";
import { buildCorpusReviewModel } from "./corpus-review-model";

test("a 7-value by 10-screen crawl reviews as ten complete screen groups", () => {
  const values = ["en", "it", "pt-BR", "de", "fr", "ja", "ar"];
  const screens = Array.from({ length: 10 }, (_, screenIndex) =>
    values.map((locale) => screenFixture(screenIndex, locale)),
  ).flat();

  const model = buildCorpusReviewModel(sessionFixture(values, screens));

  assert.equal(model.coverage.shots, 70);
  assert.equal(model.coverage.logical, 10);
  assert.equal(model.coverage.complete, 10);
  assert.equal(model.coverage.partial, 0);
  assert.equal(model.groups.length, 10);
  assert.ok(model.groups.every((group) => group.screens.length === 7));
  assert.ok(model.groups.every((group) => group.representative.locale === "en"));
});

test("coverage stays partial when a value is absent or an unknown value is duplicated", () => {
  const values = ["en", "it", "de"];
  const screens = [
    screenFixture(0, "en"),
    screenFixture(0, "it"),
    screenFixture(0, "debug"),
    screenFixture(0, "debug", "duplicate"),
  ];

  const model = buildCorpusReviewModel(sessionFixture(values, screens));

  assert.deepEqual(model.coverage, { shots: 4, logical: 1, complete: 0, partial: 1 });
  assert.equal(model.groups[0]?.coveredValues, 3);
  assert.equal(model.groups[0]?.expectedValues, 3);
});

function screenFixture(index: number, locale: string, suffix = ""): CorpusScreen {
  return {
    id: `screen-${index}-${locale}${suffix}`,
    canonicalKey: `screen-${index}`,
    fingerprint: `fingerprint-${index}-${locale}${suffix}`,
    locale,
    depth: index,
    path: [`Screen ${String(index + 1).padStart(2, "0")}`],
    pathKeys: [`screen-${index}`],
    capturedAt: index,
  };
}

function sessionFixture(locales: string[], screens: CorpusScreen[]): CorpusSession {
  return {
    id: "corpus-70",
    projectId: "default",
    name: "Seven languages x ten settings screens",
    targetId: "android-physical",
    scope: {
      locales,
      mapLocale: locales[0]!,
      strategy: "map-once-replay",
      maxDepth: 10,
      maxScreens: 250,
      maxTransitions: 500,
      maxDurationMs: 60_000,
    },
    status: "complete",
    createdAt: 1,
    updatedAt: 2,
    progress: {
      phase: "complete",
      screensCaptured: screens.length,
      transitionsCaptured: 0,
      updatedAt: 2,
    },
    screens,
    transitions: [],
  };
}
