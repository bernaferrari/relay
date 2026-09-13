import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPlanResultCell,
  planResultCellLabel,
  summarizePlanResult,
  type PlanResultCase,
} from "./plan-result-summary.js";

function cases(...items: PlanResultCase[]): PlanResultCase[] {
  return items;
}

test("one passed and nine blocked is incomplete coverage, never overall green", () => {
  const grid = summarizePlanResult([
    { status: "passed" },
    ...Array.from({ length: 9 }, () => ({ status: "blocked", findingCode: "BLOCKED" as const })),
  ]);
  assert.equal(grid.headline, "Incomplete — 1 of 10 planned cases verified");
  assert.equal(grid.detail, "1 passed, 9 blocked");
  assert.equal(grid.action, "Resolve blockers");
  assert.equal(grid.execution.passed, 1);
  assert.equal(grid.execution.blocked, 9);
  assert.equal(grid.checks.passed, 1);
  assert.equal(grid.checks.failed, 0);
  assert.equal(grid.coverage.verified, 1);
  assert.equal(grid.coverage.planned, 10);
  assert.equal(grid.executionLine, "1 passed, 9 blocked");
  assert.equal(grid.coverageLine, "1 of 10 planned cases verified");
  assert.doesNotMatch(grid.headline, /Plan completed/u);
  assert.doesNotMatch(`${grid.headline} ${grid.detail}`, /100%/u);
  assert.doesNotMatch(`${grid.headline} ${grid.detail}`, /need your eyes/u);
});

test("a rate-limit assertion is a product check failure, not infra from prose", () => {
  assert.equal(
    classifyPlanResultCell({
      status: "failed",
      findingCode: "PRODUCT_ASSERTION",
      failureCategory: "deterministic-assertion",
      outcome: "product-failure",
    }),
    "check-failed",
  );
  assert.equal(planResultCellLabel("check-failed"), "Check failed");
  const grid = summarizePlanResult(
    cases({
      status: "failed",
      findingCode: "PRODUCT_ASSERTION",
      failureCategory: "deterministic-assertion",
    }),
  );
  assert.equal(grid.checks.failed, 1);
  assert.equal(grid.execution.blocked, 0);
  assert.equal(grid.cells["could-not-run"], 0);
});

test("user cancellation is cancelled, not an infra root cause", () => {
  assert.equal(
    classifyPlanResultCell({ status: "cancelled", findingCode: "USER_CANCELLED" }),
    "cancelled",
  );
  assert.equal(
    classifyPlanResultCell({ status: "cancelled", findingCode: "HARNESS_FAILURE" }),
    "could-not-run",
  );
  assert.equal(planResultCellLabel("cancelled"), "Cancelled");
  assert.equal(planResultCellLabel("could-not-run"), "Could not run");
});

test("session-expired prose without a harness finding is not classified as infra", () => {
  assert.equal(
    classifyPlanResultCell({
      status: "failed",
      findingCode: "PRODUCT_ASSERTION",
    }),
    "check-failed",
  );
  assert.equal(
    classifyPlanResultCell({
      status: "failed",
      findingCode: "HARNESS_FAILURE",
    }),
    "could-not-run",
  );
});
