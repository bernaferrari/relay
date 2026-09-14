import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceAnalysisReport } from "@relay/protocol";
import {
  accountReloginFindingsReport,
  planFindingReviewEffect,
  proposePlanFinding,
  renderPlanFindingsMarkdown,
} from "./plan-findings.js";

const report = (findings: CombineEvidenceAnalysisReport["analysis"]["findings"]) =>
  ({
    schemaVersion: 1,
    batchId: "batch-1",
    locales: ["en", "ja"],
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
    coverage: { frames: 4, inspectedFrames: 4 },
    cases: [],
  }) satisfies CombineEvidenceAnalysisReport;

test("Confirm and Reject never accept a visual baseline", () => {
  const confirm = planFindingReviewEffect("confirm");
  const reject = planFindingReviewEffect("reject");
  assert.equal(confirm.acceptsVisualBaseline, false);
  assert.equal(confirm.visualReviewAction, null);
  assert.equal(confirm.triageStatus, "investigating");
  assert.equal(reject.triageStatus, "wont-fix");
  assert.equal(reject.acceptsVisualBaseline, false);
  assert.match(confirm.note, /does not accept a new visual baseline/);
});

test("findings markdown names Confirm/Reject and forbids implied baseline accept", () => {
  const markdown = renderPlanFindingsMarkdown(
    report([
      {
        id: "f-1",
        code: "SCREEN_MISSING",
        severity: "critical",
        confidence: "high",
        canonicalKey: "settings",
        screenLabel: "Settings",
        locale: "ja",
        baselineLocale: "en",
        detail: "Settings header missing",
      },
    ]),
  );
  assert.match(markdown, /Plan findings — batch-1/);
  assert.match(markdown, /SCREEN_MISSING/);
  assert.match(markdown, /\*\*Proposed:\*\* Confirm/);
  assert.match(markdown, /\*\*Confirm:\*\*/);
  assert.match(markdown, /relay run visual review/);
  assert.doesNotMatch(markdown, /approve-new-baseline/i);
});

test("empty findings stay explicit", () => {
  const markdown = renderPlanFindingsMarkdown(report([]));
  assert.match(markdown, /No findings/);
  assert.match(markdown, /rate-limit SOS, or a Cloudflare block is not a product pass/);
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

test("qualified locale findings propose Reject without accepting a baseline", () => {
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
  assert.doesNotMatch(proposal.reason, /accept a visual baseline/i);
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
  assert.equal(report.analysis.findings.length, 1);
  assert.equal(report.analysis.findings[0]?.code, "ACCOUNT_NEEDS_RELOGIN");
  const proposal = proposePlanFinding(report.analysis.findings[0]!);
  assert.equal(proposal.verdict, "reject");
  assert.match(proposal.reason, /Infra/u);
  const markdown = renderPlanFindingsMarkdown(report);
  assert.match(markdown, /ACCOUNT_NEEDS_RELOGIN/u);
  assert.match(markdown, /Sign-ins/u);
  assert.doesNotMatch(markdown, /approve-new-baseline/i);
});
