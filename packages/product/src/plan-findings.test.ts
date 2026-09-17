import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceAnalysisReport } from "@relay/protocol";
import {
  accountReloginFindingsReport,
  accountReloginBatchIdFromError,
  emptyPlanFindingsReport,
  planFindingLane,
  planFindingLaneLabel,
  planFindingReviewEffect,
  planFindingsEmptyCopy,
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
  const confirm = planFindingReviewEffect("confirm");
  const reject = planFindingReviewEffect("reject");
  assert.equal(confirm.acceptsVisualBaseline, false);
  assert.equal(confirm.visualReviewAction, null);
  assert.equal(reject.acceptsVisualBaseline, false);
  assert.equal(reject.visualReviewAction, null);
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
  assert.match(markdown, /rate-limit SOS, or a Cloudflare block is not a product pass/);
  assert.equal(emptyPlanFindingsReport("batch-1").analysis.findings.length, 0);
  assert.match(markdown, /relay run visual review/);
  assert.match(markdown, /Sign-ins/);
  assert.match(markdown, /Report/);
  assert.doesNotMatch(markdown, /approve-new-baseline/i);
});

test("empty findings do not hide a failed cell", () => {
  const markdown = renderPlanFindingsMarkdown({
    ...report([]),
    cases: [
      {
        jobId: "98a2abc2",
        locale: "logged-out",
        status: "error",
        frames: [],
      },
    ],
  });
  assert.match(markdown, /QA bug, not a pass/);
  assert.doesNotMatch(markdown, /No findings\. Passing cases/);
});

test("empty findings treat a failed Plan grid as a QA gap even when analysis omitted the cell", () => {
  const copy = planFindingsEmptyCopy(report([]), { hasProblems: true });
  assert.match(copy.join(" "), /QA bug, not a pass/);
  assert.doesNotMatch(copy.join(" "), /No findings\. Passing cases/);
});

test("empty findings do not hide a cancelled SOS cell", () => {
  const markdown = renderPlanFindingsMarkdown({
    ...report([]),
    cases: [
      {
        jobId: "099e8094-8018-4d44-b00b-73d2290b2f3f",
        locale: "logged-out",
        status: "cancelled",
        frames: [],
      },
    ],
  });
  assert.match(markdown, /QA bug, not a pass/);
  assert.match(markdown, /SOS\/cancelled/);
  assert.doesNotMatch(markdown, /No findings\. Passing cases/);
});

test("morning review lanes stay Product vs Infra", () => {
  assert.equal(
    planFindingLane({
      id: "f-product",
      code: "PRODUCT_ASSERTION",
      severity: "critical",
      confidence: "high",
      canonicalKey: "job:1",
      screenLabel: "Home",
      locale: "en",
      baselineLocale: "en",
      detail: "expect-screen missed",
    }),
    "product",
  );
  assert.equal(planFindingLaneLabel("infra"), "Infra");
  assert.equal(
    planFindingLane({
      id: "f-harness",
      code: "HARNESS_FAILURE",
      severity: "critical",
      confidence: "high",
      canonicalKey: "job:2",
      screenLabel: "Toolbar",
      locale: "en",
      baselineLocale: "en",
      detail: "SOS",
    }),
    "infra",
  );
  assert.equal(
    planFindingLane({
      id: "f-judge",
      code: "JUDGE_UNCERTAIN",
      severity: "warning",
      confidence: "medium",
      canonicalKey: "job:3",
      screenLabel: "Home",
      locale: "en",
      baselineLocale: "en",
      detail: "judges disagree",
    }),
    "review",
  );
  const judge = proposePlanFinding({
    id: "f-judge",
    code: "JUDGE_UNCERTAIN",
    severity: "warning",
    confidence: "medium",
    canonicalKey: "job:3",
    screenLabel: "Home",
    locale: "en",
    baselineLocale: "en",
    detail: "judges disagree",
  });
  assert.equal(judge.verdict, "reject");
  assert.match(judge.reason, /Needs review/u);
  assert.doesNotMatch(judge.reason, /approve-new-baseline/iu);
  assert.equal(planFindingReviewEffect("reject").visualReviewAction, null);
});

test("HARNESS_FAILURE from SOS/cancelled proposes Reject and never accepts a baseline", () => {
  const proposal = proposePlanFinding({
    id: "harness-failure-099e8094-8018-4d44-b00b-73d2290b2f3f",
    code: "HARNESS_FAILURE",
    severity: "critical",
    confidence: "high",
    canonicalKey: "job:099e8094-8018-4d44-b00b-73d2290b2f3f",
    screenLabel: "Toolbar on existing chat signed-in (no composer)",
    locale: "logged-out",
    baselineLocale: "logged-out",
    detail:
      "SOS: cold recovery blocked — Open first sidebar chat and assert toolbar — expect-set: options did not match",
  });
  assert.equal(proposal.verdict, "reject");
  assert.match(proposal.reason, /Infra/);
  assert.match(proposal.reason, /does not accept a visual baseline/);
  assert.equal(planFindingReviewEffect("reject").visualReviewAction, null);
  assert.equal(planFindingReviewEffect("confirm").visualReviewAction, null);
});

test("expect-screen product findings propose Confirm and never accept a baseline", () => {
  const proposal = proposePlanFinding({
    id: "f-product",
    code: "PRODUCT_ASSERTION",
    severity: "critical",
    confidence: "high",
    canonicalKey: "job:98a2abc2",
    screenLabel: "Logged-out continue conversation",
    locale: "logged-out",
    baselineLocale: "logged-out",
    expected: "Logged-out continue conversation",
    observed: "unknown",
    detail: "expect-screen: on “unknown”, not “Logged-out continue conversation”",
  });
  assert.equal(proposal.verdict, "confirm");
  assert.match(proposal.reason, /does not accept a visual baseline/);
});

test("OPENROUTER harness findings stay Incomplete, never a product pass", () => {
  const jobs = ["home", "settings"];
  const markdown = renderPlanFindingsMarkdown({
    schemaVersion: 1,
    batchId: "judged-1",
    locales: ["logged-out"],
    analysis: {
      schemaVersion: 1,
      sessionId: "judged-1",
      generatedAt: 1,
      baselineLocale: "logged-out",
      findings: jobs.map((id) => ({
        id: `harness-failure-${id}`,
        code: "HARNESS_FAILURE" as const,
        severity: "critical" as const,
        confidence: "high" as const,
        canonicalKey: `job:${id}`,
        screenLabel: id,
        locale: "logged-out",
        baselineLocale: "logged-out",
        detail: "visual judge unavailable: OPENROUTER_API_KEY is not configured",
      })),
      critical: 2,
      warnings: 0,
      affectedScreens: 2,
    },
    coverage: { frames: 2, inspectedFrames: 2 },
    cases: jobs.map((id) => ({ jobId: id, locale: "logged-out", status: "error", frames: [] })),
  });
  assert.match(markdown, /Incomplete — 0 of 2 planned cases verified/u);
  assert.match(markdown, /Incomplete \/ harness — not a product pass/u);
  assert.match(markdown, /HARNESS_FAILURE/);
  assert.match(markdown, /OPENROUTER_API_KEY/);
  assert.doesNotMatch(markdown, /100%/u);
  assert.doesNotMatch(markdown, /All selected cases passed/u);
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

test("markdown names the Test and a flaky label without hiding the finding", () => {
  const markdown = renderPlanFindingsMarkdown(
    report([
      {
        id: "f-login",
        code: "PRODUCT_ASSERTION",
        severity: "critical",
        confidence: "high",
        canonicalKey: "job:job-1",
        screenLabel: "Login",
        locale: "en",
        baselineLocale: "en",
        testId: "login",
        detail: "expect-screen missed",
      },
    ]),
    new Set(["login"]),
  );
  assert.match(markdown, /\*\*Test:\*\* login/u);
  assert.match(markdown, /\*\*Stability:\*\* Flaky/u);
  assert.match(markdown, /never skips a run or accepts a visual baseline/u);
  assert.match(markdown, /expect-screen missed/u);
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
