import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceFinding } from "@relay/protocol";
import {
  isProductAssertionJob,
  jobOutcomeFindings,
  mergeJobOutcomeFindings,
} from "./combine-evidence-job-findings.js";

test("expect-screen product-failure becomes a PRODUCT_ASSERTION finding", () => {
  const findings = jobOutcomeFindings(
    [
      {
        id: "98a2abc2",
        action: "cell-send-hello",
        status: "error",
        title: "Grok.com daily logged-out · logged-out · Send hello while logged out",
        error:
          "1 campaign check failed: Submit: expect-screen: on “unknown”, not “Logged-out continue conversation”",
        outcome: "product-failure",
        failureCategory: "deterministic-assertion",
      },
    ],
    () => "logged-out",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "PRODUCT_ASSERTION");
  assert.equal(findings[0]?.severity, "critical");
  assert.equal(findings[0]?.expected, "Logged-out continue conversation");
  assert.equal(findings[0]?.observed, "unknown");
  assert.equal(findings[0]?.screenLabel, "Logged-out continue conversation");
  assert.match(findings[0]?.detail ?? "", /expect-screen/);
});

test("visual judge unavailable without OPENROUTER is HARNESS_FAILURE", () => {
  const findings = jobOutcomeFindings(
    [
      {
        id: "c1d4213d",
        action: "cell-home-judged",
        status: "error",
        title: "Grok.com logged-out judged chrome · logged-out · Judge logged-out home chrome",
        error: "visual judge unavailable: OPENROUTER_API_KEY is not configured",
        outcome: "harness-failure",
        failureCategory: "environment",
      },
    ],
    () => "logged-out",
  );
  assert.equal(findings[0]?.code, "HARNESS_FAILURE");
  assert.match(findings[0]?.detail ?? "", /OPENROUTER_API_KEY/);
});

test("ok cells and harness failures stay typed", () => {
  assert.equal(
    isProductAssertionJob({ id: "ok", action: "t", status: "ok", outcome: "passed" }),
    false,
  );
  const findings = jobOutcomeFindings(
    [
      { id: "ok", action: "t", status: "ok", outcome: "passed" },
      {
        id: "lease",
        action: "t",
        status: "error",
        error: "lease expired",
        outcome: "harness-failure",
      },
    ],
    () => "en",
  );
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["HARNESS_FAILURE"],
  );
});

test("cancelled SOS combine cells are HARNESS_FAILURE, not a silent empty page", () => {
  const findings = jobOutcomeFindings(
    [
      {
        id: "099e8094-8018-4d44-b00b-73d2290b2f3f",
        action: "cell-c03c491650ffb1839a645c0054f0bc852",
        status: "cancelled",
        title:
          "Grok.com signed-in chrome visual · logged-out · Toolbar on existing chat signed-in (no composer)",
        error: "Cancelled by user",
        outcome: "cancelled",
        artifacts: [
          {
            kind: "campaign-recovery-intervention",
            data: {
              reason:
                "expect-set: options did not match within identifier grok-app-root (missing: Copy response, Dislike, Like, More actions, Regenerate; unexpected: none)",
              checkTitle: "Open first sidebar chat and assert toolbar",
              transitionId: "connection-grok-web-signed-in-toolbar-existing",
            },
          },
        ],
      },
      {
        id: "8afe4558-5bdd-4fa9-baf3-9f8520cb720a",
        action: "cell-c92ae660900c496eed0e859e94b983ab1",
        status: "cancelled",
        title:
          "Grok.com signed-in chrome visual · logged-out · Open existing sidebar conversation signed-in",
        error: "Cancelled by user",
        outcome: "cancelled",
        artifacts: [
          {
            kind: "campaign-recovery-intervention",
            data: {
              reason: "expect-screen: on “unknown”, not “Signed-in conversation”",
              checkTitle: "Open existing sidebar conversation signed-in",
              transitionId: "connection-grok-web-signed-in-open-conversation",
            },
          },
        ],
      },
    ],
    () => "logged-out",
  );
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["HARNESS_FAILURE", "HARNESS_FAILURE"],
  );
  assert.match(findings[0]?.detail ?? "", /SOS: cold recovery blocked/);
  assert.match(findings[0]?.detail ?? "", /expect-set/);
  assert.match(findings[1]?.detail ?? "", /expect-screen/);
  assert.match(findings[0]?.screenLabel ?? "", /Toolbar on existing chat/);
  assert.match(findings[1]?.screenLabel ?? "", /Open existing sidebar conversation/);
});

test("cancelled without SOS artifacts is operator cancellation, not infra", () => {
  const findings = jobOutcomeFindings(
    [
      {
        id: "cancelled-plain",
        action: "cell-x",
        status: "cancelled",
        outcome: "cancelled",
        error: "Cancelled by user",
      },
    ],
    () => "en",
  );
  assert.equal(findings[0]?.code, "USER_CANCELLED");
  assert.match(findings[0]?.detail ?? "", /not an infra root cause/u);
});

test("a rate-limit assertion stays PRODUCT_ASSERTION", () => {
  const findings = jobOutcomeFindings(
    [
      {
        id: "rate-limit-assert",
        action: "assert-limit",
        status: "error",
        outcome: "product-failure",
        failureCategory: "deterministic-assertion",
        error: 'content assertion: response did not satisfy contains "rate limit"',
      },
    ],
    () => "en",
  );
  assert.equal(findings[0]?.code, "PRODUCT_ASSERTION");
});

test("blocked cells are BLOCKED coverage gaps", () => {
  const findings = jobOutcomeFindings(
    [
      {
        id: "blocked-1",
        action: "cell-blocked",
        status: "blocked",
        error: "Device not connected",
      },
    ],
    () => "en",
  );
  assert.equal(findings[0]?.code, "BLOCKED");
});

test("merge recounts critical findings so empty locale analysis cannot hide a failed cell", () => {
  const empty = {
    findings: [] as CombineEvidenceFinding[],
    critical: 0,
    warnings: 0,
    affectedScreens: 0,
  };
  const merged = mergeJobOutcomeFindings(
    empty,
    jobOutcomeFindings(
      [
        {
          id: "job-1",
          action: "send-hello",
          status: "error",
          error: "expect-screen: on “unknown”, not “Logged-out continue conversation”",
          outcome: "product-failure",
        },
      ],
      () => "logged-out",
    ),
  );
  assert.equal(merged.critical, 1);
  assert.equal(merged.findings[0]?.code, "PRODUCT_ASSERTION");
});
