import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceControl } from "./combine-evidence-session.js";
import type { FrameObservation } from "./frame-observation.js";
import { analyzeLocaleRunPack, type LocaleRunPackCapture } from "./locale-run-analysis.js";

function control(stableKey: string, label: string, width = 120): CombineEvidenceControl {
  return {
    id: `${stableKey}-1`,
    label,
    stableKey,
    target: { identifier: stableKey },
    rect: { x: 0, y: 0, width, height: 44 },
  };
}

function observation(controls: CombineEvidenceControl[], caption = "settings"): FrameObservation {
  return {
    schemaVersion: 1,
    framePath: "frames/001.png",
    caption,
    fingerprint: controls.map((item) => item.label).join("|"),
    title: "Settings",
    controls,
  };
}

function capture(input: Partial<LocaleRunPackCapture> & { locale: string }): LocaleRunPackCapture {
  return {
    jobId: `job-${input.locale}`,
    index: 0,
    packPath: `${input.locale}/001-screen.png`,
    sha256: `sha-${input.locale}`,
    ...input,
  };
}

test("an untranslated row in one locale becomes a finding on that cell's frame", () => {
  const { analysis, byCanonicalKey } = analyzeLocaleRunPack({
    batchId: "batch-1",
    title: "Settings · locales",
    locales: ["en", "pt-BR"],
    compareText: true,
    captures: [
      capture({
        locale: "en",
        observation: observation([
          control("settings.language", "App Language"),
          control("settings.about", "About"),
        ]),
      }),
      capture({
        locale: "pt-BR",
        observation: observation([
          control("settings.language", "App Language"),
          control("settings.about", "Sobre"),
        ]),
      }),
    ],
  });

  const finding = analysis.findings.find((item) => item.locale === "pt-BR");
  assert.equal(finding?.code, "POSSIBLE_UNTRANSLATED_TEXT");
  assert.equal(finding?.stableKey, "settings.language");
  assert.equal(finding?.canonicalKey, "frame-001");
  assert.equal(byCanonicalKey["frame-001"]?.["pt-BR"], "pt-BR/001-screen.png");
  assert.equal(analysis.baselineLocale, "en");
});

test("the compared set is the same whichever locale is the baseline", () => {
  // The readability floor was read off the baseline's copy alone, so it was the
  // baseline's language that decided which controls were comparable at all:
  // "Ask" is under the floor and "Chiedi" is not. A sweep that started in
  // Italian saw the tab vanish from pt-BR; the same sweep started in English
  // reported nothing and still called its coverage complete.
  const missingFrom = (baseline: "en" | "it"): string[] => {
    const { analysis } = analyzeLocaleRunPack({
      batchId: "batch-1",
      title: "Ask · locales",
      locales: baseline === "en" ? ["en", "it", "pt-BR"] : ["it", "en", "pt-BR"],
      compareText: true,
      captures: [
        capture({
          locale: "en",
          observation: observation([
            control("navigation.tab.ask", "Ask"),
            control("toolbar.model.selector.button", "Expert"),
          ]),
        }),
        capture({
          locale: "it",
          observation: observation([
            control("navigation.tab.ask", "Chiedi"),
            control("toolbar.model.selector.button", "Esperto"),
          ]),
        }),
        capture({
          locale: "pt-BR",
          observation: observation([control("toolbar.model.selector.button", "Especialista")]),
        }),
      ],
    });
    return analysis.findings
      .filter((finding) => finding.code === "CONTROL_MISSING")
      .map((finding) => `${finding.locale}:${finding.stableKey}`)
      .sort();
  };

  assert.deepEqual(missingFrom("en"), missingFrom("it"));
  assert.deepEqual(missingFrom("en"), ["pt-BR:navigation.tab.ask"]);
});

test("a translation that keeps the original box reports the shared clipping code", () => {
  const { analysis } = analyzeLocaleRunPack({
    batchId: "batch-1",
    title: "Settings · locales",
    locales: ["en", "de"],
    compareText: true,
    captures: [
      capture({
        locale: "en",
        observation: observation([control("settings.language", "Language")]),
      }),
      capture({
        locale: "de",
        observation: observation([control("settings.language", "Anzeigesprache der App")]),
      }),
    ],
  });

  assert.deepEqual(
    analysis.findings.map((item) => item.code),
    ["POSSIBLE_TEXT_CLIPPED"],
  );
});

test("a case that never captured a frame is missing, not silently clean", () => {
  const { analysis } = analyzeLocaleRunPack({
    batchId: "batch-1",
    title: "Settings · locales",
    locales: ["en", "it"],
    compareText: true,
    captures: [capture({ locale: "en", observation: observation([control("row", "Language")]) })],
  });

  assert.deepEqual(
    analysis.findings.map((item) => [item.code, item.locale]),
    [["SCREEN_MISSING", "it"]],
  );
  assert.equal(analysis.critical, 1);
});

test("a single-locale matrix has nothing to compare and reports nothing", () => {
  const { analysis, coverage } = analyzeLocaleRunPack({
    batchId: "batch-1",
    title: "Settings",
    locales: ["en"],
    compareText: true,
    captures: [capture({ locale: "en", observation: observation([control("row", "Language")]) })],
  });

  assert.deepEqual(analysis.findings, []);
  assert.deepEqual(coverage, { frames: 1, inspectedFrames: 1 });
});

test("combine cases differ by state, so their copy is never read as a translation", () => {
  const { analysis, coverage } = analyzeLocaleRunPack({
    batchId: "batch-1",
    title: "Kids Mode × Settings",
    locales: ["kids-on", "kids-off"],
    compareText: false,
    captures: [
      capture({ locale: "kids-on", observation: observation([control("row", "Language")]) }),
      capture({ locale: "kids-off", observation: observation([control("row", "Language")]) }),
      capture({ locale: "kids-on", index: 1, packPath: "kids-on/002-screen.png", sha256: "b" }),
    ],
  });

  assert.deepEqual(
    analysis.findings.map((item) => [item.code, item.locale]),
    [["SCREEN_MISSING", "kids-off"]],
  );
  assert.equal(coverage.inspectedFrames, 2);
});

test("frames captured without a UI tree are still checked for presence", () => {
  const { analysis, coverage, frames } = analyzeLocaleRunPack({
    batchId: "batch-1",
    title: "Settings · locales",
    locales: ["en", "fr"],
    compareText: true,
    captures: [capture({ locale: "en" }), capture({ locale: "fr" })],
  });

  assert.deepEqual(analysis.findings, []);
  assert.deepEqual(coverage, { frames: 2, inspectedFrames: 0 });
  assert.deepEqual(
    frames.map((frame) => frame.inspected),
    [false, false],
  );
});
