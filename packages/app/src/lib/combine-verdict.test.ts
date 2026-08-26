import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceFinding, CombineEvidenceFindingCode } from "@relay/protocol";
import {
  type CombineCellAnalysis,
  combineCellDefectCount,
  combineCellVerdict,
  combineFindingHeadline,
  combineVerdictOrder,
  combineVerdictPresentation,
  summarizeCombineVerdicts,
} from "./combine-verdict";
import type { CombineRow } from "./combine-review";

const frame = { path: "shot.png", capturedAt: 1 } as NonNullable<
  CombineRow["captures"][number]["frame"]
>;
const captured = { frame };

const finding = (
  code: CombineEvidenceFindingCode,
  overrides: Partial<CombineEvidenceFinding> = {},
): CombineEvidenceFinding => ({
  id: `${code}-1`,
  code,
  severity: "critical",
  confidence: "high",
  canonicalKey: "settings/appearance",
  screenLabel: "Appearance",
  locale: "de-DE",
  baselineLocale: "en-US",
  detail: "Detail sentence.",
  ...overrides,
});

test("a captured cell with no analysis is not counted as a pass", () => {
  assert.equal(combineCellVerdict({ status: "ok", capture: captured }), "unanalyzed");
});

test("an analysed cell with no findings passes", () => {
  const analysis: CombineCellAnalysis = { findings: [], baselineLabel: "English" };
  assert.equal(combineCellVerdict({ status: "ok", capture: captured, analysis }), "pass");
});

test("the worst finding on a cell decides its verdict", () => {
  const analysis: CombineCellAnalysis = {
    findings: [finding("POSSIBLE_UNTRANSLATED_TEXT"), finding("POSSIBLE_TEXT_CLIPPED")],
  };
  assert.equal(combineCellVerdict({ status: "ok", capture: captured, analysis }), "clipped");

  const notApplied: CombineCellAnalysis = {
    findings: [finding("POSSIBLE_TEXT_CLIPPED"), finding("POSSIBLE_LOCALE_NOT_APPLIED")],
  };
  assert.equal(
    combineCellVerdict({ status: "ok", capture: captured, analysis: notApplied }),
    "not-applied",
  );
});

test("every protocol finding code maps to a verdict with a presentation", () => {
  const codes: CombineEvidenceFindingCode[] = [
    "SCREEN_MISSING",
    "POSSIBLE_LOCALE_NOT_APPLIED",
    "CONTROL_MISSING",
    "POSSIBLE_UNTRANSLATED_TEXT",
    "POSSIBLE_TEXT_CLIPPED",
  ];
  for (const code of codes) {
    const verdict = combineCellVerdict({
      status: "ok",
      capture: captured,
      analysis: { findings: [finding(code)] },
    });
    assert.notEqual(verdict, "pass", `${code} must not read as a pass`);
    assert.ok(combineVerdictOrder.includes(verdict));
  }
});

test("run state outranks any analysis of a stale capture", () => {
  const analysis: CombineCellAnalysis = { findings: [] };
  assert.equal(combineCellVerdict({ status: "error", capture: captured, analysis }), "failed");
  assert.equal(combineCellVerdict({ status: "running", capture: captured, analysis }), "pending");
});

test("a finished run with no screenshot reports the missing capture", () => {
  assert.equal(combineCellVerdict({ status: "ok", capture: { frame: undefined } }), "missing");
  assert.equal(combineCellVerdict({ status: "ok", capture: undefined }), "missing");
});

test("medium confidence findings are phrased as possibilities", () => {
  assert.equal(
    combineFindingHeadline(finding("POSSIBLE_TEXT_CLIPPED", { confidence: "medium" })),
    "Possible clipped text",
  );
  assert.equal(
    combineFindingHeadline(finding("POSSIBLE_TEXT_CLIPPED", { confidence: "high" })),
    "Clipped text",
  );
});

test("every verdict has a presentation and a unique place in the legend order", () => {
  for (const verdict of combineVerdictOrder) {
    const presentation = combineVerdictPresentation(verdict);
    assert.equal(presentation.verdict, verdict);
    assert.ok(presentation.label.length > 0);
    assert.ok(presentation.hint.endsWith("."));
  }
  assert.equal(new Set(combineVerdictOrder).size, combineVerdictOrder.length);
});

test("tallies are defect-first and only include verdicts present in the grid", () => {
  const row = (status: string, hasFrame: boolean): CombineRow =>
    ({
      job: { status },
      world: status,
      values: [],
      captures: [{ index: 0, caption: "Settings", frame: hasFrame ? frame : undefined }],
      missingCaptures: hasFrame ? 0 : 1,
    }) as unknown as CombineRow;

  const tallies = summarizeCombineVerdicts(
    [row("ok", true), row("ok", true), row("error", true), row("ok", false)],
    0,
  );

  assert.deepEqual(tallies, [
    { verdict: "failed", count: 1 },
    { verdict: "missing", count: 1 },
    { verdict: "unanalyzed", count: 2 },
  ]);
  // "missing" is a warning about capture coverage, not a product defect.
  assert.equal(combineCellDefectCount(tallies), 1);
});
