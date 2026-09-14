import assert from "node:assert/strict";
import test from "node:test";
import { laneSessionPartition, laneTabSessionKey } from "./lane-session.ts";

test("desktop partition is the same Lane identity the product UI uses", () => {
  assert.equal(laneSessionPartition("grok-auth-gmail"), "persist:lane:grok-auth-gmail");
  assert.equal(laneTabSessionKey("grok-auth-gmail", "grok-com"), "lane:grok-auth-gmail");
  assert.notEqual(laneSessionPartition("grok-auth-gmail"), laneSessionPartition("grok-auth-email"));
  assert.notEqual(
    laneTabSessionKey("grok-auth-gmail", "grok-com"),
    laneTabSessionKey("grok-auth-email", "grok-com"),
  );
  assert.throws(() => laneSessionPartition("../etc"), /not a safe Electron partition/);
});
