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

test("only editable test failures offer a test repair", () => {
  assert.equal(canFixFailureInTest("locator"), true);
  assert.equal(canFixFailureInTest("visual-assertion"), true);
  assert.equal(canFixFailureInTest("environment"), false);
  assert.equal(canFixFailureInTest("harness-defect"), false);
  assert.equal(canFixFailureInTest(undefined), false);
});
