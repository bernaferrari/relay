import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscoveryVerifyError,
  DISCOVERY_SETTLE_MS,
  discoveryFingerprintsChanged,
  discoverySettleMs,
} from "./discovery-verify.js";

test("settle delays: back waits longer than tap", () => {
  assert.equal(discoverySettleMs("tap"), DISCOVERY_SETTLE_MS.tap);
  assert.equal(discoverySettleMs("type"), DISCOVERY_SETTLE_MS.tap);
  assert.equal(discoverySettleMs("scroll"), DISCOVERY_SETTLE_MS.tap);
  assert.equal(discoverySettleMs("manual"), DISCOVERY_SETTLE_MS.tap);
  assert.equal(discoverySettleMs("back"), DISCOVERY_SETTLE_MS.back);
  assert.ok(discoverySettleMs("back") > discoverySettleMs("tap"));
});

test("fingerprint change detection is strict inequality", () => {
  assert.equal(discoveryFingerprintsChanged("abc", "abc"), false);
  assert.equal(discoveryFingerprintsChanged("abc", "abd"), true);
  assert.equal(discoveryFingerprintsChanged("", "x"), true);
});

test("DiscoveryVerifyError carries a structured code", () => {
  const err = new DiscoveryVerifyError("snapshot_failed", "tree unavailable");
  assert.equal(err.name, "DiscoveryVerifyError");
  assert.equal(err.code, "snapshot_failed");
  assert.equal(err.message, "tree unavailable");
  assert.ok(err instanceof Error);
});
