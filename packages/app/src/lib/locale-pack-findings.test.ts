import assert from "node:assert/strict";
import test from "node:test";
import type {
  CombineEvidenceFinding,
  LocaleRunAnalysisReport,
  LocaleRunPackManifest,
} from "@relay/protocol";
import {
  localeCellAnalysisIndex,
  packFindingsByCase,
  packFindingsForFrame,
  packFindingsSummary,
} from "./locale-pack-findings";

function finding(
  input: Partial<CombineEvidenceFinding> & { locale: string },
): CombineEvidenceFinding {
  return {
    id: `finding-${input.locale}`,
    code: "POSSIBLE_UNTRANSLATED_TEXT",
    severity: "warning",
    confidence: "medium",
    canonicalKey: "frame-001",
    screenLabel: "Settings",
    baselineLocale: "en",
    detail: "unchanged copy",
    ...input,
  };
}

const manifest: LocaleRunPackManifest = {
  schemaVersion: 2,
  batchId: "batch-1",
  recipeId: "settings",
  title: "Settings · locales",
  generatedAt: 1,
  locales: ["en", "pt-BR", "it"],
  cases: [
    { locale: "en", jobId: "job-en", status: "ok", name: "en", frames: ["en/1.png"] },
    { locale: "pt-BR", jobId: "job-pt", status: "ok", name: "pt-BR", frames: ["pt-br/1.png"] },
    { locale: "it", jobId: "job-it", status: "error", name: "it", frames: [] },
  ],
  byCanonicalKey: { "frame-001": { en: "en/1.png", "pt-BR": "pt-br/1.png" } },
  analysis: {
    schemaVersion: 1,
    sessionId: "batch-1",
    generatedAt: 1,
    baselineLocale: "en",
    critical: 1,
    warnings: 1,
    affectedScreens: 1,
    findings: [
      finding({ locale: "it", code: "SCREEN_MISSING", severity: "critical", confidence: "high" }),
      finding({ locale: "pt-BR" }),
    ],
  },
  analysisCoverage: { frames: 2, inspectedFrames: 1 },
};

test("every cell reports its own findings, including the clean ones", () => {
  const cells = packFindingsByCase(manifest);
  assert.deepEqual(
    cells.map((cell) => [cell.locale, cell.findings.length, cell.critical]),
    [
      ["en", 0, 0],
      ["pt-BR", 1, 0],
      ["it", 1, 1],
    ],
  );
  assert.equal(cells[1]?.findings[0]?.frame, "pt-br/1.png");
  // A case that captured nothing has no frame to point at, only the finding.
  assert.equal(cells[2]?.findings[0]?.frame, undefined);
});

test("a summary states what could not be read rather than implying a clean sweep", () => {
  assert.deepEqual(packFindingsSummary(manifest), {
    baselineLocale: "en",
    total: 2,
    critical: 1,
    warnings: 1,
    affectedScreens: 1,
    unreadFrames: 1,
  });
});

test("an opened screenshot can ask which findings were observed on it", () => {
  assert.deepEqual(
    packFindingsForFrame(manifest, "pt-br/1.png").map((item) => item.locale),
    ["pt-BR"],
  );
  assert.deepEqual(packFindingsForFrame(manifest, "en/1.png"), []);
});

const report: LocaleRunAnalysisReport = {
  schemaVersion: 1,
  batchId: "batch-1",
  locales: ["en", "pt-BR", "it"],
  coverage: { frames: 3, inspectedFrames: 2 },
  cases: [
    {
      jobId: "job-en",
      locale: "en",
      status: "ok",
      frames: [{ framePath: "frames/001.png", canonicalKey: "frame-001", inspected: true }],
    },
    {
      jobId: "job-pt",
      locale: "pt-BR",
      status: "ok",
      frames: [{ framePath: "frames/001.png", canonicalKey: "frame-001", inspected: true }],
    },
    {
      jobId: "job-it",
      locale: "it",
      status: "ok",
      frames: [{ framePath: "frames/001.png", canonicalKey: "frame-001", inspected: false }],
    },
  ],
  analysis: manifest.analysis,
};

test("the grid asks per run and frame, and a clean analysed cell says so", () => {
  const cell = localeCellAnalysisIndex(report);
  assert.deepEqual(cell("job-en", "frames/001.png"), { findings: [], baselineLabel: "en" });
  assert.deepEqual(
    cell("job-pt", "frames/001.png")?.findings.map((item) => item.code),
    ["POSSIBLE_UNTRANSLATED_TEXT"],
  );
});

test("a cell the analysis never covered stays unchecked instead of passing", () => {
  const cell = localeCellAnalysisIndex(report);
  // No screenshot, no report, and a frame captured without a tree that came
  // back clean: none of those earned a pass.
  assert.equal(cell("job-en", undefined), undefined);
  assert.equal(cell("job-en", "frames/009.png"), undefined);
  assert.equal(localeCellAnalysisIndex(null)("job-en", "frames/001.png"), undefined);
  const uninspected = localeCellAnalysisIndex({
    ...report,
    analysis: { ...report.analysis, findings: [] },
  });
  assert.equal(uninspected("job-it", "frames/001.png"), undefined);
});

test("a finding on an uninspected frame is still reported", () => {
  const cell = localeCellAnalysisIndex(report);
  assert.deepEqual(
    cell("job-it", "frames/001.png")?.findings.map((item) => item.code),
    ["SCREEN_MISSING"],
  );
});
