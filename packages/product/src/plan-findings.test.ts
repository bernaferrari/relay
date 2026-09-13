import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceAnalysisReport } from "@relay/protocol";
import {
  accountReloginFindingsReport,
  accountReloginBatchIdFromError,
  planFindingReviewEffect,
  proposePlanFinding,
  renderPlanFindingsMarkdown,
} from "./plan-findings.js";

const report = (findings: CombineEvidenceAnalysisReport["analysis"]["findings"]) =>
  ({
    schemaVersion: 1,
    batchId: "batch-1",
    locales: ["en"],
    analysis: {
      schemaVersion: 1,
      sessionId: "s1",
      generatedAt: 1,
      baselineLocale: "en",
      findings,
      critical: findings.filter((item) => item.severity === "critical").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
      affectedScreens: findings.length ? 1 : 0,
    },
    coverage: { frames: 1, inspectedFrames: 1 },
    cases: [],
  }) satisfies CombineEvidenceAnalysisReport;

test("Confirm never accepts a visual baseline", () => {
  assert.equal(planFindingReviewEffect("confirm").acceptsVisualBaseline, false);
  assert.equal(planFindingReviewEffect("reject").visualReviewAction, null);
});

test("markdown names Confirm and Reject", () => {
  const markdown = renderPlanFindingsMarkdown(
    report([
      {
        id: "f-1",
        code: "SCREEN_MISSING",
        severity: "critical",
        confidence: "high",
        canonicalKey: "chat",
        screenLabel: "Chat",
        locale: "en",
        baselineLocale: "en",
        detail: "Composer missing",
      },
    ]),
  );
  assert.match(markdown, /Confirm/);
  assert.match(markdown, /Proposed/);
  assert.match(markdown, /relay run visual review/);
});

test("qualified findings propose Reject", () => {
  const proposal = proposePlanFinding({
    id: "f-2",
    code: "POSSIBLE_UNTRANSLATED_TEXT",
    severity: "warning",
    confidence: "medium",
    canonicalKey: "composer",
    screenLabel: "Home",
    locale: "ja",
    baselineLocale: "en",
    detail: "English copy still visible",
  });
  assert.equal(proposal.verdict, "reject");
});

test("empty findings keep the morning review copy", () => {
  const markdown = renderPlanFindingsMarkdown(report([]));
  assert.match(markdown, /No findings/);
  assert.match(markdown, /relay run visual review/);
  assert.match(markdown, /Sign-ins/);
  assert.match(markdown, /Report/);
  assert.doesNotMatch(markdown, /approve-new-baseline/i);
});

test("expired sign-in is one Infra finding, not a product failure", () => {
  const report = accountReloginFindingsReport({
    detail: "Member expired. Open Sign-ins, complete OAuth, then Refresh.",
    generatedAt: 1,
  });
  assert.equal(report.analysis.findings[0]?.code, "ACCOUNT_NEEDS_RELOGIN");
  assert.equal(proposePlanFinding(report.analysis.findings[0]!).verdict, "reject");
  assert.match(renderPlanFindingsMarkdown(report), /ACCOUNT_NEEDS_RELOGIN/u);
});

test("expired Plan start exposes the persisted Result id", () => {
  assert.equal(
    accountReloginBatchIdFromError({
      status: 409,
      body: { code: "ACCOUNT_NEEDS_RELOGIN", batchId: "result-1" },
    }),
    "result-1",
  );
  assert.equal(accountReloginBatchIdFromError({ code: "ACCOUNT_NEEDS_RELOGIN" }), undefined);
  assert.equal(
    accountReloginBatchIdFromError({
      status: 500,
      body: { code: "ACCOUNT_NEEDS_RELOGIN", batchId: "result-1" },
    }),
    undefined,
  );
});
