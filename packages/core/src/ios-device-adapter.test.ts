import assert from "node:assert/strict";
import test from "node:test";
import { IosRunnerSetupError, normalizeIosRunnerError } from "./ios-device-adapter.js";

test("maps signing failures to the Relay iOS setup action", () => {
  const error = normalizeIosRunnerError(
    new Error("xcodebuild build-for-testing failed: Provisioning profile is required"),
  );
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /could not sign its local iPad runner/);
});

test("maps disabled Developer Mode to the Relay iOS setup action", () => {
  const error = normalizeIosRunnerError(new Error("Developer Mode is not enabled on this iPad"));
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /Turn on Developer Mode/);
});

test("explains automatic and manual signing conflicts directly", () => {
  const error = normalizeIosRunnerError(
    new Error("AgentDeviceRunner is automatically signed, but code signing identity has been manually specified"),
  );
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /manual signing override/);
});

test("explains when Xcode has no account for the configured Apple team", () => {
  const error = normalizeIosRunnerError(
    new Error('No Account for Team "ABCDE12345". Add a new account in Accounts settings.'),
  );
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /Xcode is not signed in to this Apple team/);
});

test("keeps regular runner failures intact", () => {
  const original = new Error("The iPad was unplugged");
  assert.equal(normalizeIosRunnerError(original), original);
});
