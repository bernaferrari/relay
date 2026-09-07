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
