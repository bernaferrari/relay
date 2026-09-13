import assert from "node:assert/strict";
import test from "node:test";
import type { ProductBatchCase } from "./run-across.js";
import {
  classifyProductResultCell,
  planResultColumnIdentity,
  productResultCellLabel,
  summarizeProductResultGrid,
} from "./plan-result-cells.js";

function item(status: ProductBatchCase["status"], error?: string): ProductBatchCase {
  return {
    id: status,
    index: 0,
    phase: "coverage",
    status,
    values: {},
    ...(error ? { error } : {}),
  };
}

test("classifies typed Result cells and excludes infra from the product pass rate", () => {
  assert.equal(classifyProductResultCell(item("passed")), "passed");
  assert.equal(classifyProductResultCell(item("failed", "VISUAL_CHANGED")), "changed");
  assert.equal(classifyProductResultCell(item("failed", "judge uncertain: sources")), "judged");
  assert.equal(classifyProductResultCell(item("failed", "No active session")), "infra");
  assert.equal(
    classifyProductResultCell(
      item("failed", "Member opened signed out. Open Sign-ins, complete OAuth, then Refresh."),
    ),
    "infra",
  );
  assert.equal(classifyProductResultCell(item("failed", "pause: Continue with camera")), "manual");
  assert.equal(classifyProductResultCell(item("failed", "ACCOUNT_NEEDS_RELOGIN")), "infra");
  assert.equal(
    classifyProductResultCell(
      item("failed", "You've reached your SuperGrok limit. 21 hours 11 minutes before limit is gone"),
    ),
    "infra",
  );
  assert.equal(
    classifyProductResultCell(item("failed", "SOS: cold recovery blocked — intervention required")),
    "infra",
  );
  assert.equal(classifyProductResultCell(item("failed", "Cloudflare blocked the x.ai handoff")), "infra");
  assert.equal(
    classifyProductResultCell(
      item(
        "failed",
        "UNSUPPORTED_PLATFORM: No recorded Android route. Do not invent Grok Settings navigation.",
      ),
    ),
    "infra",
  );
  assert.equal(productResultCellLabel("infra"), "Infra");

  const grid = summarizeProductResultGrid([
    item("passed"),
    item("passed"),
    item("failed", "toolbar icon missing"),
    item("failed", "VISUAL_CHANGED"),
    item("failed", "No active session"),
    item("blocked"),
  ]);
  assert.equal(grid.passed, 2);
  assert.equal(grid.failed, 1);
  assert.equal(grid.changed, 1);
  assert.equal(grid.infra, 2);
  assert.equal(grid.needEyes, 2);
  assert.equal(grid.productTotal, 4);
  assert.equal(grid.productPassRate, 0.5);
  assert.equal(grid.headline, "1 changed, 1 failed, 2 need your eyes");
});

test("six accounts on one browser stay six Result columns", () => {
  const shared = { targetProfileId: "browser:grok-com" };
  const ids = ["a", "b", "c", "d", "e", "f"].map(
    (letter) =>
      planResultColumnIdentity({
        ...shared,
        account: { kind: "fixture", accountId: `acct-${letter}`, accountRevision: "1" },
      }).environmentId,
  );
  assert.equal(new Set(ids).size, 6);
  assert.equal(
    planResultColumnIdentity({
      targetProfileId: "pixel-8",
    }).environmentId,
    "pixel-8",
  );
  assert.equal(
    planResultColumnIdentity({
      targetProfileId: "browser:grok-com",
      account: { kind: "signed-out", attested: true },
    }).environmentLabel,
    "Logged out",
  );
});
