import assert from "node:assert/strict";
import test from "node:test";
import { planFindingsReportFromError } from "./plan-findings-cli.js";

test("reads one Infra findings report from a fail-closed combine.start error", () => {
  const report = planFindingsReportFromError({
    code: "ACCOUNT_NEEDS_RELOGIN",
    findings: {
      schemaVersion: 1,
      batchId: "preflight",
      locales: ["en"],
      analysis: {
        schemaVersion: 1,
        sessionId: "preflight",
        generatedAt: 1,
        baselineLocale: "en",
        findings: [
          {
            id: "account-needs-relogin",
            code: "ACCOUNT_NEEDS_RELOGIN",
            severity: "critical",
            confidence: "high",
            canonicalKey: "account",
            screenLabel: "Sign-ins",
            locale: "en",
            baselineLocale: "en",
            detail: "Member expired.",
          },
        ],
        critical: 1,
        warnings: 0,
        affectedScreens: 1,
      },
      coverage: { frames: 0, inspectedFrames: 0 },
      cases: [],
    },
  });
  assert.equal(report?.analysis.findings[0]?.code, "ACCOUNT_NEEDS_RELOGIN");
  assert.equal(planFindingsReportFromError({ code: "ACCOUNT_NEEDS_RELOGIN" }), undefined);
});
