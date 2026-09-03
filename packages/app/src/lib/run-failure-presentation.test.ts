import assert from "node:assert/strict";
import test from "node:test";
import { canFixFailureInTest, friendlyError, readableFailure } from "./run-failure-presentation";

test("disconnected targets are presented as a device problem, not generic setup", () => {
  const error = "device missing: tablet-1 is no longer connected";
  assert.equal(readableFailure("environment", error), "Device unavailable");
  assert.equal(
    friendlyError(error),
    "This device is no longer connected. Reconnect it or choose another, then try again.",
  );
});

test("other environment failures remain setup issues", () => {
  assert.equal(readableFailure("environment", "Xcode is not configured"), "Setup");
});

test("a refused browser target is explained without exposing the Playwright trace", () => {
  assert.equal(
    friendlyError(
      'environment preflight failed: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:64674/settings?head=repaired Call log: navigating to "http://127.0.0.1:64674/settings?head=repaired"',
    ),
    "The app under test is not running at its saved address. Start it, then retry this Run.",
  );
});

test("localized tour gaps explain the incremental repair loop", () => {
  assert.equal(
    friendlyError(
      "tour: mapped row(s) are absent from the complete live list on Settings: Appearance",
    ),
    "This locale exposes a different list structure. Review the named missing row, update its map binding once, then retry only problem locales.",
  );
  assert.match(friendlyError("tour:row-not-found — could not find live row"), /Retry this locale/);
});

test("only editable test failures offer a test repair", () => {
  assert.equal(canFixFailureInTest("locator"), true);
  assert.equal(canFixFailureInTest("visual-assertion"), true);
  assert.equal(canFixFailureInTest("environment"), false);
  assert.equal(canFixFailureInTest("harness-defect"), false);
  assert.equal(canFixFailureInTest(undefined), false);
});
