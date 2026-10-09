import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceFindingCode } from "@relay/protocol";
import type { ProductBatchCase } from "./run-across.js";
import {
  classifyProductResultCell,
  planResultColumnIdentity,
  productResultCellLabel,
  summarizeProductResultGrid,
} from "./plan-result-cells.js";

function item(
  status: ProductBatchCase["status"],
  extras?: {
    error?: string;
    findingCode?: CombineEvidenceFindingCode;
    failureCategory?: ProductBatchCase["failureCategory"];
    outcome?: string;
  },
): ProductBatchCase {
  return {
    id: status,
    index: 0,
    phase: "coverage",
    status,
    values: {},
    ...(extras?.error ? { error: extras.error } : {}),
    ...(extras?.findingCode ? { findingCode: extras.findingCode } : {}),
    ...(extras?.failureCategory ? { failureCategory: extras.failureCategory } : {}),
    ...(extras?.outcome ? { outcome: extras.outcome } : {}),
  };
}

test("one passed and nine blocked is incomplete, never plan completed", () => {
  const grid = summarizeProductResultGrid([
    item("passed"),
    ...Array.from({ length: 9 }, () => item("blocked", { findingCode: "BLOCKED" })),
  ]);
  assert.equal(grid.headline, "Incomplete — 1 of 10 planned cases verified");
  assert.equal(grid.detail, "1 passed, 9 blocked");
  assert.equal(grid.action, "Resolve blockers");
  assert.equal(grid.coverage.verified, 1);
  assert.equal(grid.coverage.planned, 10);
  assert.equal(grid.execution.passed, 1);
  assert.equal(grid.execution.blocked, 9);
  assert.equal(grid.executionLine, "1 passed, 9 blocked");
  assert.equal(grid.checksLine, "1 passed");
  assert.equal(grid.coverageLine, "1 of 10 planned cases verified");
  assert.doesNotMatch(grid.headline, /Plan completed/u);
});

test("classifies typed findings without error-string regex", () => {
  assert.equal(classifyProductResultCell(item("passed")), "passed");
  assert.equal(
    classifyProductResultCell(
      item("failed", { findingCode: "VISUAL_CHANGED", failureCategory: "visual-assertion" }),
    ),
    "needs-review",
  );
  assert.equal(
    classifyProductResultCell(
      item("failed", { findingCode: "JUDGE_UNCERTAIN", failureCategory: "judge-uncertainty" }),
    ),
    "needs-review",
  );
  assert.equal(
    classifyProductResultCell(item("failed", { findingCode: "HARNESS_FAILURE" })),
    "could-not-run",
  );
  assert.equal(
    classifyProductResultCell(item("failed", { findingCode: "ACCOUNT_NEEDS_RELOGIN" })),
    "could-not-run",
  );
  assert.equal(
    classifyProductResultCell(item("failed", { findingCode: "MANUAL_CHECKPOINT" })),
    "needs-review",
  );
  assert.equal(
    classifyProductResultCell(
      item("failed", {
        findingCode: "PRODUCT_ASSERTION",
        failureCategory: "deterministic-assertion",
        error: "You've reached your SuperGrok limit. 21 hours 11 minutes before limit is gone",
      }),
    ),
    "check-failed",
  );
  assert.equal(
    classifyProductResultCell(item("cancelled", { findingCode: "USER_CANCELLED" })),
    "cancelled",
  );
  assert.equal(productResultCellLabel("could-not-run"), "Could not run");
  assert.equal(productResultCellLabel("check-failed"), "Check failed");
});

test("six accounts on one browser stay six Result columns with human labels", () => {
  const shared = { targetProfileId: "browser:grok-com", targetLabel: "Grok.com" };
  const ids = ["a", "b", "c", "d", "e", "f"].map(
    (letter) =>
      planResultColumnIdentity({
        ...shared,
        account: {
          kind: "fixture",
          accountId: `acct-${letter}`,
          accountRevision: "1",
          accountLabel: `Member ${letter}`,
        },
      }).environmentId,
  );
  assert.equal(new Set(ids).size, 6);
  assert.equal(
    planResultColumnIdentity({
      targetProfileId: "pixel-8",
      targetLabel: "Pixel 8",
    }).environmentLabel,
    "Pixel 8",
  );
  assert.equal(
    planResultColumnIdentity({
      targetProfileId: "browser:grok-com",
      targetLabel: "Grok.com",
      account: { kind: "signed-out", attested: true },
    }).environmentLabel,
    "Logged out · Grok.com",
  );
  assert.equal(
    planResultColumnIdentity({
      targetProfileId: "browser:grok-com",
      targetLabel: "Grok.com",
      account: {
        kind: "fixture",
        accountId: "acct-a",
        accountRevision: "1",
        accountLabel: "Member A",
      },
    }).environmentLabel,
    "Member A · Grok.com",
  );
  assert.equal(
    planResultColumnIdentity({
      targetProfileId: "browser:grok-com",
      targetLabel: "Grok.com",
      account: {
        kind: "fixture",
        accountId: "7189423f-193e-45ed-b674-154505cc5107",
        accountRevision: "1",
      },
    }).environmentLabel,
    "Grok.com",
  );
  assert.equal(
    planResultColumnIdentity({
      targetProfileId: "browser:grok-com",
      targetLabel: "Grok.com",
      account: {
        kind: "fixture",
        accountId: "7189423f-193e-45ed-b674-154505cc5107",
        accountRevision: "1",
        accountLabel: "SuperGrok lab signed-in",
      },
    }).environmentLabel,
    "SuperGrok lab signed-in · Grok.com",
  );
});
