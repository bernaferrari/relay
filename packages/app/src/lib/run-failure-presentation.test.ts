import assert from "node:assert/strict";
import test from "node:test";
import { friendlyError, readableFailure } from "./run-failure-presentation";

test("disconnected targets are presented as a device problem, not generic setup", () => {
  const error = "device missing: tablet-1 is no longer connected";
  assert.equal(readableFailure("environment", error), "Device unavailable");
  assert.equal(
    friendlyError(error),
    "This device is no longer connected. Reconnect it or choose another target, then retry.",
  );
});

test("other environment failures remain setup issues", () => {
  assert.equal(readableFailure("environment", "Xcode is not configured"), "Setup");
});
