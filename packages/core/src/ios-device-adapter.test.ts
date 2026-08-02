import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  diagnoseIosRunnerError,
  IosRunnerSetupError,
  normalizeIosRunnerError,
} from "./ios-device-adapter.js";

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
    new Error(
      "AgentDeviceRunner is automatically signed, but code signing identity has been manually specified",
    ),
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

test("reads signing diagnostics from the selected iPad session", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-runner-log-"));
  const previousStateDir = process.env.AGENT_DEVICE_STATE_DIR;
  const udid = "device:with/unsafe characters";
  try {
    process.env.AGENT_DEVICE_STATE_DIR = root;
    const session = join(root, "sessions", "relay-ios-device-with-unsafe-characters");
    await mkdir(session, { recursive: true });
    await writeFile(
      join(session, "runner.log"),
      'error: No Account for Team "ABCDE12345". Add a new account in Accounts settings.\n',
      "utf8",
    );

    const error = await diagnoseIosRunnerError(new Error("xcodebuild failed"), udid);
    assert.ok(error instanceof IosRunnerSetupError);
    assert.match(error.message, /Xcode is not signed in to this Apple team/);
  } finally {
    if (previousStateDir === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
    else process.env.AGENT_DEVICE_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps regular runner failures intact", () => {
  const original = new Error("The iPad was unplugged");
  assert.equal(normalizeIosRunnerError(original), original);
});
