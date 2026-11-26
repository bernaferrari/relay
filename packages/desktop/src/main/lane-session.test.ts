import assert from "node:assert/strict";
import test from "node:test";
import {
  laneHttpUrl,
  laneSessionPartition,
  laneTabSessionKey,
  laneWindowNeedsNavigation,
} from "./lane-session.ts";

test("desktop partition is the same Lane identity the product UI uses", () => {
  assert.equal(laneSessionPartition("account-gmail"), "persist:lane:account-gmail");
  assert.equal(laneTabSessionKey("account-gmail", "example-com"), "lane:account-gmail");
  assert.notEqual(laneSessionPartition("account-gmail"), laneSessionPartition("account-email"));
  assert.notEqual(
    laneTabSessionKey("account-gmail", "example-com"),
    laneTabSessionKey("account-email", "example-com"),
  );
  assert.notEqual(laneSessionPartition("seeded-member"), "id__lane_seeded-member");
  assert.throws(() => laneSessionPartition("../etc"), /not a safe browser session key/u);
  assert.throws(() => laneTabSessionKey("   ", "example-com"), /not a safe browser session key/u);
  assert.throws(
    () => laneSessionPartition("example-com__lane_daily-lane"),
    /cannot reuse Playwright user-data/u,
  );
});

test("lane pages and cookies reject non-http URLs", () => {
  assert.equal(laneHttpUrl("https://example.test/settings").href, "https://example.test/settings");
  assert.throws(() => laneHttpUrl("file:///etc/passwd"), /http\(s\) URLs/u);
  assert.throws(() => laneHttpUrl("javascript:alert(1)"), /http\(s\) URLs/u);
  assert.throws(() => laneHttpUrl("not a url"), /http\(s\) URLs/u);
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
