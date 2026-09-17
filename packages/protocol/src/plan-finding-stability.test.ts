import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceFinding } from "./combine-evidence-contract.js";
import {
  planFindingIsFlaky,
  planFindingTestId,
  visiblePlanFindings,
} from "./plan-finding-stability.js";

const finding = (
  partial: Partial<CombineEvidenceFinding> & Pick<CombineEvidenceFinding, "id">,
): CombineEvidenceFinding => ({
  code: "PRODUCT_ASSERTION",
  severity: "critical",
  confidence: "high",
  canonicalKey: `job:${partial.id}`,
  screenLabel: "Home chrome",
  locale: "en",
  baselineLocale: "en",
  detail: "expect-screen missed",
  ...partial,
});

test("blank or missing Test id is not identity and is not flaky", () => {
  const unlabeled = finding({ id: "a" });
  const blank = finding({ id: "b", testId: "  " });
  const flaky = new Set(["login"]);
  assert.equal(planFindingTestId(unlabeled), undefined);
  assert.equal(planFindingTestId(blank), undefined);
  assert.equal(planFindingIsFlaky(unlabeled, flaky), false);
  assert.equal(planFindingIsFlaky(blank, flaky), false);
});

test("a finding is flaky only for an exact Test id in the comparable set", () => {
  const login = finding({ id: "a", testId: "login" });
  const toolbar = finding({ id: "b", testId: "toolbar" });
  const flaky = new Set(["login"]);
  assert.equal(planFindingIsFlaky(login, flaky), true);
  assert.equal(planFindingIsFlaky(toolbar, flaky), false);
  assert.equal(planFindingIsFlaky(finding({ id: "c", screenLabel: "login" }), flaky), false);
});

test("hide flaky is a view filter and sorts labelled items last without dropping identity-less rows", () => {
  const rows = [
    finding({ id: "flaky", testId: "login", screenLabel: "Login" }),
    finding({ id: "open", testId: "home", screenLabel: "Home" }),
    finding({ id: "orphan", screenLabel: "Unknown" }),
  ];
  const flakyTestIds = new Set(["login"]);
  const ranked = visiblePlanFindings(rows, { hideFlaky: false, flakyTestIds });
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["open", "orphan", "flaky"],
  );
  const hidden = visiblePlanFindings(rows, { hideFlaky: true, flakyTestIds });
  assert.deepEqual(
    hidden.map((item) => item.id),
    ["open", "orphan"],
  );
});
