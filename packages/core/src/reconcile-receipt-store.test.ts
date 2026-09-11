import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before } from "node:test";
const prior = process.env.RELAY_STATE_DIR;
let root: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "relay-receipts-"));
  process.env.RELAY_STATE_DIR = root;
});
after(() => {
  if (prior === undefined) delete process.env.RELAY_STATE_DIR;
  else process.env.RELAY_STATE_DIR = prior;
  rmSync(root, { recursive: true, force: true });
});
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearReconcileReceipts,
  readReconcileReceipt,
  rememberReconcileReceipt,
} from "./reconcile-receipt-store.js";

test("a lost reconcile response retrieves the same durable resolution", () => {
  clearReconcileReceipts();
  const first = rememberReconcileReceipt({
    serial: "pixel-1",
    mutationId: "ios-input-1",
    outcome: "not-applied",
    health: { state: "ready" },
  });
  const retry = rememberReconcileReceipt({
    serial: "pixel-1",
    mutationId: "ios-input-1",
    outcome: "applied",
  });
  const fetched = readReconcileReceipt({ resolutionId: first.resolutionId });
  const byMutation = readReconcileReceipt({ serial: "pixel-1", mutationId: "ios-input-1" });
  assert.equal(retry.resolutionId, first.resolutionId);
  assert.equal(retry.outcome, "not-applied");
  assert.equal(fetched?.outcome, "not-applied");
  assert.equal(byMutation?.resolutionId, first.resolutionId);
  assert.equal(readReconcileReceipt({ resolutionId: "missing" }), undefined);
});

test("ambiguous attempts progress while exact retries and project boundaries are preserved", () => {
  const scope = { organizationId: "org", projectId: "one", serial: "browser", mutationId: "click" };
  const first = rememberReconcileReceipt({
    ...scope,
    resolutionId: "attempt-1",
    outcome: "ambiguous",
    reviewedAt: 1,
  });
  clearReconcileReceipts();
  assert.equal(readReconcileReceipt({ ...scope, resolutionId: "attempt-1" })?.outcome, "ambiguous");
  assert.equal(
    readReconcileReceipt({ ...scope, projectId: "two", resolutionId: "attempt-1" }),
    undefined,
  );
  assert.equal(
    readReconcileReceipt({ ...scope, serial: "other", resolutionId: "attempt-1" }),
    undefined,
  );
  const next = rememberReconcileReceipt({
    ...scope,
    resolutionId: "attempt-2",
    outcome: "applied",
    reviewedAt: 2,
  });
  assert.notEqual(first.resolutionId, next.resolutionId);
  assert.equal(readReconcileReceipt(scope)?.outcome, "applied");
  assert.equal(
    rememberReconcileReceipt({ ...scope, resolutionId: "attempt-1", outcome: "not-applied" })
      .outcome,
    "ambiguous",
  );
});
