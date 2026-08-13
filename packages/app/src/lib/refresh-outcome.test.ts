import assert from "node:assert/strict";
import test from "node:test";
import { runCatalogRefreshState, type RefreshOutcome } from "./refresh-outcome";

const ok: RefreshOutcome = { ok: true };

test("a partial refresh failure keeps the prior success timestamp and names the failed source", () => {
  const previous = { error: null, lastSuccessAt: 100 };
  const next = runCatalogRefreshState(previous, { ok: false, error: "network" }, ok, 200);
  assert.equal(next.lastSuccessAt, 100);
  assert.match(next.error ?? "", /jobs: network/);
  assert.match(next.error ?? "", /Showing saved results/);
});

test("two failures are reported together without making stale results look fresh", () => {
  const next = runCatalogRefreshState(
    { error: null, lastSuccessAt: null },
    { ok: false, error: "jobs unavailable" },
    { ok: false, error: "runs unavailable" },
    200,
  );
  assert.equal(next.lastSuccessAt, null);
  assert.match(next.error ?? "", /jobs unavailable/);
  assert.match(next.error ?? "", /runs unavailable/);
});

test("a recovered refresh clears the error and records only the successful completion", () => {
  const next = runCatalogRefreshState({ error: "old failure", lastSuccessAt: 100 }, ok, ok, 300);
  assert.deepEqual(next, { error: null, lastSuccessAt: 300 });
});

test("a first-load failure does not claim that nonexistent saved results are visible", () => {
  const next = runCatalogRefreshState(
    { error: null, lastSuccessAt: null },
    { ok: false, error: "offline" },
    ok,
    300,
    false,
  );
  assert.match(next.error ?? "", /No saved results are available yet/);
  assert.doesNotMatch(next.error ?? "", /Showing saved results/);
});
