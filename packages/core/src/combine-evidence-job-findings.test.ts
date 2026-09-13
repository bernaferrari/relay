import assert from "node:assert/strict";
import test from "node:test";
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

test("merge recounts critical findings so empty locale analysis cannot hide a failed cell", () => {
  const merged = mergeJobOutcomeFindings(
    { findings: [], critical: 0, warnings: 0, affectedScreens: 0 },
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
