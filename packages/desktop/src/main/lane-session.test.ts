import assert from "node:assert/strict";
import test from "node:test";
import {
  assertElectronGrokLabTabAllowed,
  electronGrokLabPartitionPresentOnDisk,
  laneSessionPartition,
  laneTabSessionKey,
  laneWindowNeedsNavigation,
} from "./lane-session.ts";

test("desktop partition is the same Lane identity the product UI uses", () => {
  assert.equal(laneSessionPartition("grok-auth-gmail"), "persist:lane:grok-auth-gmail");
  assert.equal(laneTabSessionKey("grok-auth-gmail", "grok-com"), "lane:grok-auth-gmail");
  assert.notEqual(laneSessionPartition("grok-auth-gmail"), laneSessionPartition("grok-auth-email"));
  assert.notEqual(
    laneTabSessionKey("grok-auth-gmail", "grok-com"),
    laneTabSessionKey("grok-auth-email", "grok-com"),
  );
  assert.notEqual(laneSessionPartition("seeded-member"), "id__lane_seeded-member");
  assert.throws(() => laneSessionPartition("../etc"), /not a safe Electron partition/);
  assert.throws(
    () => laneSessionPartition("grok-com__lane_grok-daily"),
    /cannot reuse Playwright user-data/u,
  );
});

test("reopening a Lane window navigates when the requested URL changed", () => {
  assert.equal(
    laneWindowNeedsNavigation("https://example.test/settings", "https://example.test/settings"),
    false,
  );
  assert.equal(
    laneWindowNeedsNavigation("https://example.test/home", "https://example.test/settings"),
    true,
  );
  assert.equal(laneWindowNeedsNavigation("about:blank", "https://example.test/settings"), true);
});

test("grok-lab Electron tab is refused when persist:lane:grok-lab is absent", () => {
  assert.equal(electronGrokLabPartitionPresentOnDisk(["/tmp/no-such-electron-partitions"]), false);
  assert.throws(
    () => assertElectronGrokLabTabAllowed({ laneId: "grok-lab", partitionPresent: false }),
    /persist:lane:grok-lab is absent/u,
  );
  assert.doesNotThrow(() =>
    assertElectronGrokLabTabAllowed({ laneId: "grok-auth-gmail", partitionPresent: false }),
  );
  assert.doesNotThrow(() =>
    assertElectronGrokLabTabAllowed({ laneId: "grok-lab", partitionPresent: true }),
  );
});
