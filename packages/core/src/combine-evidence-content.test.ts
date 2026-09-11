import assert from "node:assert/strict";
import test from "node:test";
import { compareCapturedContent } from "./combine-evidence-content.js";
import type { CombineEvidenceCapture } from "./combine-evidence-batch-analysis.js";

function capture(path: string, text?: string, index = 0): CombineEvidenceCapture {
  return {
    locale: path,
    jobId: path,
    index,
    packPath: path,
    ...(text ? { nodes: [{ index: 0, type: "text", label: text }] } : {}),
  };
}
test("content comparison normalizes Unicode and whitespace without dropping captures", () => {
  const result = compareCapturedContent([
    capture("en", "café  plans"),
    capture("fr", "cafe\u0301 plans"),
    capture("de", "Andere"),
    capture("missing"),
    capture("second", "café plans", 1),
  ]);
  assert.equal(result.pages.length, 5);
  assert.equal(result.inspectedPages, 4);
  assert.equal(result.uniquePages, 3);
  assert.deepEqual(result.duplicateGroups, [["en", "fr"]]);
  assert.equal(result.pages[3]?.textSha256, undefined);
});
test("ordered repetitions remain significant", () => {
  const first = capture("one", "Price");
  const second = capture("two", "Price");
  second.nodes!.push({ index: 1, type: "text", label: "Price" });
  assert.equal(compareCapturedContent([first, second]).duplicateGroups.length, 0);
});
